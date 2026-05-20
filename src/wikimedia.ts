interface Candidate {
  title: string;
  url: string;
  thumb: string;
  mime: string;
  width: number;
  height: number;
  rank: number;
}

const resolvedCache = new Map<string, string | null>();

const JUNK_TITLE = /(coat[_ ]of[_ ]arms|brasao|flag[_ ]of|bandeira[_ ]d[oae]|seal[_ ]of|selo[_ ]d[oae]|logo|svg_logo|disambig|stub|stamp|signature|signatures)/i;
const MAP_TITLE = /(map_of|mapa_d[oae]|location_map|locator|world[_ ]map|topography)/i;
const FICTION_TOKENS = /\b(m[ií]stic[oa]s?|m[ií]tic[oa]s?|fict[ií]ci[oa]s?|fict[ií]on(?:al)?|sobrenatural|sobrenaturais|invented|inventad[oa]s?|ancestral|ancestrais|sagrad[oa]s?|lend[áa]ri[oa]s?|encantad[oa]s?|atomico|at[ôo]mic[oa]s?)\b/giu;
const STOP_TOKENS = /\b(de|do|da|dos|das|of|the|a|o|e|um|uma|with|com|para|in|em|no|na|nos|nas|el|la|los|las|incidente|incident|crisis|crise|case|caso|event|evento|fenomeno|fen[ôo]meno|the)\b/giu;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function expandQueries(raw: string): string[] {
  const t = (raw || '').replace(/[“”"']/g, '').trim();
  if (!t) return [];
  const queries: string[] = [];
  const push = (s: string) => {
    const trimmed = s.replace(/\s+/g, ' ').trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  };

  push(t);

  const stripped = t.replace(FICTION_TOKENS, ' ').replace(/[(),:;]/g, ' ');
  push(stripped);

  const noStop = stripped.replace(STOP_TOKENS, ' ');
  push(noStop);

  const words = noStop.split(/\s+/).filter(Boolean);
  if (words.length >= 3) push(words.slice(0, 3).join(' '));
  if (words.length >= 2) push(words.slice(0, 2).join(' '));
  if (words.length >= 2) push(words.slice(-2).join(' '));

  // Prefer proper nouns: words that start uppercase in the ORIGINAL term.
  const properNouns = (raw.match(/\b[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][\p{L}]+/gu) || [])
    .filter((w) => w.length >= 3);
  for (const pn of properNouns) push(pn);

  // Last-ditch single-word fallbacks
  if (words.length >= 1) push(words[0]);
  if (words.length >= 1) push(words[words.length - 1]);

  return queries;
}

async function commonsSearch(query: string, limit = 8): Promise<Candidate[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
    iiurlwidth: '600',
  });
  let r: Response;
  try {
    r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  } catch {
    return [];
  }
  if (!r.ok) return [];
  let data: { query?: { pages?: Record<string, unknown> } };
  try {
    data = await r.json();
  } catch {
    return [];
  }
  const pages = data?.query?.pages;
  if (!pages) return [];
  const out: Candidate[] = [];
  for (const k of Object.keys(pages)) {
    const p = pages[k] as {
      title?: string;
      index?: number;
      imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        mime?: string;
        width?: number;
        height?: number;
      }>;
    };
    const ii = p?.imageinfo?.[0];
    if (!ii?.url || !ii.mime) continue;
    if (!/^image\//.test(ii.mime)) continue;
    out.push({
      title: p.title || '',
      url: ii.url,
      thumb: ii.thumburl || ii.url,
      mime: ii.mime,
      width: ii.width || 0,
      height: ii.height || 0,
      rank: typeof p.index === 'number' ? p.index : 99,
    });
  }
  // Stable-sort by ascending rank so iteration order reflects Commons relevance.
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

function scoreCandidate(c: Candidate, queryTokens: string[], allowSymbols: boolean): number {
  let s = 0;
  const title = c.title.toLowerCase();
  const titleTokens = tokenize(c.title);

  // Commons relevance rank (biggest signal). Rank 1 → +50, rank 10 → +5.
  s += Math.max(0, 55 - c.rank * 5);

  // Token-match in title — exact word-bounded match dominates.
  let allHit = queryTokens.length > 0;
  let anyHit = false;
  for (const q of queryTokens) {
    if (titleTokens.includes(q)) {
      anyHit = true;
    } else if (title.includes(q)) {
      anyHit = true;
      allHit = false;
    } else {
      allHit = false;
    }
  }
  if (allHit) s += 80;
  else if (anyHit) s += 25;

  // Filter junk unless the query explicitly asked for a symbol.
  if (!allowSymbols && JUNK_TITLE.test(title)) s -= 120;
  if (!allowSymbols && MAP_TITLE.test(title)) s -= 60;

  // MIME preferences, mild.
  if (c.mime === 'image/jpeg') s += 8;
  else if (c.mime === 'image/png') s += 6;
  else if (c.mime === 'image/webp') s += 4;
  else if (c.mime === 'image/svg+xml') s -= 8;
  else if (c.mime === 'image/gif') s -= 4;

  // Resolution sanity: penalize tiny thumbs, mild bonus for usable size.
  if (c.width > 0 && c.width < 150) s -= 30;
  else if (c.width >= 400) s += 3;
  // Penalize extreme aspect ratios (banners, tall scrolls).
  if (c.height > 0 && c.width / c.height > 4) s -= 20;
  if (c.height > 0 && c.height / c.width > 4) s -= 20;

  return s;
}

export async function searchCommonsImage(rawTerm: string): Promise<string | null> {
  const cacheKey = rawTerm.trim().toLowerCase();
  if (!cacheKey) return null;
  if (resolvedCache.has(cacheKey)) return resolvedCache.get(cacheKey)!;

  const allowSymbols = /\b(flag|bandeira|logo|map|mapa|brasao|coat of arms|escudo|selo|seal)\b/i.test(rawTerm);
  const queries = expandQueries(rawTerm);

  let bestEver: { c: Candidate; s: number } | null = null;

  for (const q of queries) {
    const candidates = await commonsSearch(q, 10);
    if (!candidates.length) continue;
    const qTokens = tokenize(q);
    const scored = candidates
      .map((c) => ({ c, s: scoreCandidate(c, qTokens, allowSymbols) }))
      .sort((a, b) => b.s - a.s);
    const top = scored[0];
    if (!top) continue;
    if (!bestEver || top.s > bestEver.s) bestEver = top;
    // Strong hit — stop early.
    if (top.s >= 100) {
      resolvedCache.set(cacheKey, top.c.thumb);
      return top.c.thumb;
    }
  }

  if (bestEver && bestEver.s > 0) {
    resolvedCache.set(cacheKey, bestEver.c.thumb);
    return bestEver.c.thumb;
  }

  resolvedCache.set(cacheKey, null);
  return null;
}
