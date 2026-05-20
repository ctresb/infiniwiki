import { rewriteWikipediaUrls } from './urlRewrite';

const API = import.meta.env.VITE_API_URL;

export interface TocItem {
  level: number;
  id: string;
  text: string;
}

export interface ParseResult {
  html: string;
  displayTitle: string;
  toc: TocItem[];
}

interface Prerendered {
  displayTitle: string;
  html: string;
}

const renderedCache = new Map<string, Prerendered | null>();

async function loadPrerendered(slug: string): Promise<Prerendered | null> {
  if (renderedCache.has(slug)) return renderedCache.get(slug)!;
  try {
    const r = await fetch(`${API}/pages/${encodeURIComponent(slug)}`);
    if (!r.ok) {
      renderedCache.set(slug, null);
      return null;
    }
    const data = (await r.json()) as Prerendered;
    renderedCache.set(slug, data);
    return data;
  } catch {
    renderedCache.set(slug, null);
    return null;
  }
}

export function extractToc(html: string): TocItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items: TocItem[] = [];
  doc.querySelectorAll('h2, h3, h4').forEach((h) => {
    if (h.closest('.infobox, .navbox, .reflist, .toc, .mw-references-wrap'))
      return;
    let id = h.getAttribute('id') || '';
    const headline = h.querySelector('.mw-headline');
    if (!id && headline) id = headline.getAttribute('id') || '';
    if (!id) return;
    const text = (headline?.textContent || h.textContent || '').trim();
    if (!text) return;
    const tag = h.tagName.toLowerCase();
    const level = tag === 'h2' ? 2 : tag === 'h3' ? 3 : 4;
    items.push({ level, id, text });
  });
  return items;
}

export type PageStatus =
  | { status: 'ok'; result: ParseResult }
  | { status: 'not_found'; slug: string };

export async function loadPage(slug: string): Promise<PageStatus> {
  const pre = await loadPrerendered(slug);
  if (pre) {
    const html = rewriteWikipediaUrls(pre.html);
    return {
      status: 'ok',
      result: {
        html,
        displayTitle: pre.displayTitle || slug,
        toc: extractToc(html),
      },
    };
  }
  return { status: 'not_found', slug };
}
