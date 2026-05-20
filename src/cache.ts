const API = import.meta.env.VITE_API_URL;

export interface CachedPage {
  displayTitle: string;
  html: string;
}

export async function getCached(slug: string): Promise<CachedPage | null> {
  try {
    const r = await fetch(`${API}/pages/${encodeURIComponent(slug)}`);
    if (!r.ok) return null;
    return (await r.json()) as CachedPage;
  } catch (err) {
    console.warn('[cache] GET failed', slug, err);
    return null;
  }
}

export async function putCached(slug: string, p: CachedPage): Promise<void> {
  const url = `${API}/pages/${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`cache write ${res.status}: ${body.slice(0, 200)}`);
  }
  console.info('[cache] wrote', slug, `(${p.html.length} bytes html)`);
}
