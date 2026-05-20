// Normalise URLs in cached MediaWiki HTML. Protocol-relative `//...` → https,
// MediaWiki-relative `/wiki/...` → pt.wikipedia.org. On image load failure the
// surrounding figure (or infobox row) is removed silently — no broken-image icon,
// no gray placeholder. If a figure is empty after removal, it goes too.

const WIKI_ORIGIN = 'https://pt.wikipedia.org';

const ONERROR_REMOVE_FIGURE =
  `this.onerror=null;` +
  `var fig=this.closest('[data-iw-fig]')||this.closest('.thumb')||this.closest('figure');` +
  `var row=this.closest('tr');` +
  `if(fig&&fig.tagName==='IMG'&&row){row.remove();}` +
  `else if(fig){fig.remove();}` +
  `else if(row){row.remove();}` +
  `else{this.remove();}`;

function absolutizeProtocolRelative(url: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/wiki/') || url.startsWith('/w/') || url.startsWith('/static/')) {
    return WIKI_ORIGIN + url;
  }
  return url;
}

function rewriteSrcset(srcset: string): string {
  return srcset
    .split(',')
    .map((entry) => {
      const t = entry.trim();
      if (!t) return '';
      const parts = t.split(/\s+/);
      parts[0] = absolutizeProtocolRelative(parts[0]);
      return parts.join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

export function rewriteWikipediaUrls(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) img.setAttribute('src', absolutizeProtocolRelative(src));
    const srcset = img.getAttribute('srcset');
    if (srcset) img.setAttribute('srcset', rewriteSrcset(srcset));

    // If an image arrives with no usable src, drop its figure outright rather
    // than waiting for the browser to emit an error event.
    const finalSrc = img.getAttribute('src');
    if (!finalSrc || finalSrc.trim() === '') {
      const figEl = (img.closest('[data-iw-fig]') ||
        img.closest('.thumb') ||
        img.closest('figure')) as HTMLElement | null;
      const rowEl = img.closest('tr');
      if (figEl && figEl.tagName === 'IMG' && rowEl) rowEl.remove();
      else if (figEl) figEl.remove();
      else if (rowEl) rowEl.remove();
      else img.remove();
      return;
    }

    img.setAttribute('onerror', ONERROR_REMOVE_FIGURE);
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
  });

  doc.querySelectorAll('source').forEach((s) => {
    const src = s.getAttribute('src');
    if (src) s.setAttribute('src', absolutizeProtocolRelative(src));
    const srcset = s.getAttribute('srcset');
    if (srcset) s.setAttribute('srcset', rewriteSrcset(srcset));
  });

  doc.querySelectorAll('audio,video').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) el.setAttribute('src', absolutizeProtocolRelative(src));
    const poster = el.getAttribute('poster');
    if (poster) el.setAttribute('poster', absolutizeProtocolRelative(poster));
  });

  doc.querySelectorAll('a[href]').forEach((el) => {
    const a = el as HTMLAnchorElement;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') || href.startsWith('javascript:')) return;
    if (href.startsWith('/wiki/') || href.startsWith('/w/')) {
      a.setAttribute('href', WIKI_ORIGIN + href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else if (href.startsWith('//')) {
      a.setAttribute('href', 'https:' + href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    } else if (/^https?:\/\//i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return doc.body.innerHTML;
}
