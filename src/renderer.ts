import { createParser, type RenderEvent } from './streamParser';
import { normalizeSlug } from './slug';
import { searchCommonsImage } from './wikimedia';
import type { ArticleImage, Category, Infobox, Reference, Section } from './types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function renderInline(md: string): string {
  if (!md) return '';
  let out = '';
  let i = 0;
  while (i < md.length) {
    const rest = md.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\[([^\]]+)\]\(\/([^)]*)\)/.exec(rest))) {
      const slug = normalizeSlug(m[2]);
      out += `<a href="/${slug}" title="${escapeAttr(m[1])}">${escapeHtml(m[1])}</a>`;
      i += m[0].length;
    } else if ((m = /^\*\*([^*]+)\*\*/.exec(rest))) {
      out += `<b>${escapeHtml(m[1])}</b>`;
      i += m[0].length;
    } else if ((m = /^\*([^*\n]+)\*/.exec(rest))) {
      out += `<i>${escapeHtml(m[1])}</i>`;
      i += m[0].length;
    } else {
      out += escapeHtml(md[i]);
      i++;
    }
  }
  return out;
}

function splitParagraphs(s: string): string[] {
  return s
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function renderParagraphs(s: string): string {
  return splitParagraphs(s)
    .map((p) => {
      // Defensive: the model sometimes emits subsection headings inline as
      // markdown (`### Title`, `## Title`) instead of as separate section
      // entries with level=3. Convert those to real MediaWiki headings so
      // they don't leak through as literal `###` text on the page.
      const h3 = /^###\s+(.+?)\s*$/.exec(p);
      if (h3) {
        const id = headingId(h3[1]);
        return (
          `<div class="mw-heading mw-heading3">` +
          `<h3 id="${escapeAttr(id)}">` +
          `<span class="mw-headline" id="${escapeAttr(id)}">${escapeHtml(h3[1])}</span>` +
          `</h3></div>`
        );
      }
      const h2 = /^##\s+(.+?)\s*$/.exec(p);
      if (h2) {
        const id = headingId(h2[1]);
        return (
          `<div class="mw-heading mw-heading2">` +
          `<h2 id="${escapeAttr(id)}">` +
          `<span class="mw-headline" id="${escapeAttr(id)}">${escapeHtml(h2[1])}</span>` +
          `</h2></div>`
        );
      }
      return `<p>${renderInline(p)}</p>`;
    })
    .join('');
}

function headingId(title: string): string {
  return normalizeSlug(title) || 'section';
}

export interface StreamRenderer {
  live: HTMLElement;
  getTitle(): string;
  onText(chunk: string): void;
  onEnd(): void;
  onTitle(cb: (title: string) => void): () => void;
  finalHtml(): string;
}

export function makeStreamRenderer(initialTitle: string): StreamRenderer {
  const live = document.createElement('div');
  live.className = 'mw-parser-output';

  let title = initialTitle;
  const titleSubs = new Set<(t: string) => void>();

  let imgCounter = 0;
  let imageIndex = 0;
  let refsOpen = false;
  let catsOpen = false;
  let refsListEl: HTMLOListElement | null = null;
  let catsListEl: HTMLUListElement | null = null;
  let pendingInfoboxTitle = initialTitle;

  function prepareImageFade(img: HTMLImageElement): void {
    img.classList.add('iw-img-fade');
    if (img.getAttribute('src') && img.complete && img.naturalWidth > 0) {
      img.classList.add('iw-img-loaded');
      return;
    }
    img.addEventListener(
      'load',
      () => {
        if (img.naturalWidth > 0) img.classList.add('iw-img-loaded');
      },
      { once: true }
    );
  }

  function animateFragment(root: DocumentFragment | HTMLElement): void {
    root.querySelectorAll('img').forEach(prepareImageFade);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        let p: HTMLElement | null = node.parentElement;
        while (p) {
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (p.classList && p.classList.contains('iw-char')) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) nodes.push(n as Text);

    let i = 0;
    for (const tn of nodes) {
      const text = tn.nodeValue || '';
      if (!text) continue;
      const parent = tn.parentNode;
      if (!parent) continue;
      const replacement = document.createDocumentFragment();
      for (const ch of text) {
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === ' ') {
          replacement.appendChild(document.createTextNode(ch));
          continue;
        }
        const span = document.createElement('span');
        span.className = 'iw-char';
        const delay = Math.min(i * 10, 600);
        if (delay > 0) span.style.animationDelay = `${delay}ms`;
        span.textContent = ch;
        replacement.appendChild(span);
        i++;
      }
      parent.replaceChild(replacement, tn);
    }
  }

  function appendHtml(html: string): DocumentFragment {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const frag = tpl.content;
    animateFragment(frag);
    live.appendChild(frag);
    return frag;
  }

  function appendHtmlTo(target: HTMLElement, html: string): void {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    animateFragment(tpl.content);
    target.appendChild(tpl.content);
  }

  function closeRefs(): void {
    if (!refsOpen) return;
    refsOpen = false;
    refsListEl = null;
  }

  function closeCats(): void {
    if (!catsOpen) return;
    catsOpen = false;
    catsListEl = null;
  }

  function buildImageFigure(img: ArticleImage): { html: string; id: string } {
    const id = `iw-img-${++imgCounter}`;
    const float = imageIndex++ % 2 === 0 ? 'right' : 'left';
    const captionHtml = renderInline(img.caption || '');
    const html =
      `<div class="thumb t${float}" data-iw-fig="${id}">` +
      `<div class="thumbinner" style="width:302px;">` +
      `<a class="image mw-file-description">` +
      `<img class="mw-file-element thumbimage" data-img-id="${id}" src="" alt="" width="300" loading="lazy" referrerpolicy="no-referrer">` +
      `</a>` +
      `<div class="thumbcaption">${captionHtml}</div>` +
      `</div></div>`;
    return { html, id };
  }

  async function resolveImage(id: string, search: string): Promise<void> {
    const url = await searchCommonsImage(search);
    if (url) {
      const el = live.querySelector<HTMLImageElement>(`[data-img-id="${id}"]`);
      if (el) {
        el.addEventListener(
          'load',
          () => {
            if (el.naturalWidth > 0) el.classList.add('iw-img-loaded');
          },
          { once: true }
        );
        el.src = url;
      }
    } else {
      // Remove the whole figure container. For section thumbs the container is
      // [data-iw-fig]; for the infobox image the marker is on the img itself, so
      // walk up to the nearest <tr> and drop that row.
      const fig = live.querySelector<HTMLElement>(`[data-iw-fig="${id}"]`);
      if (fig) {
        const row = fig.closest('tr');
        if (row && fig.tagName === 'IMG') row.remove();
        else fig.remove();
      }
    }
  }

  function renderHatnote(text: string): string {
    let t = (text || '').trim();
    if (t.startsWith('*') && t.endsWith('*') && t.length > 2) {
      t = t.slice(1, -1);
    }
    return `<div class="hatnote navigation-not-searchable">${renderInline(t)}</div>`;
  }

  function renderInfobox(box: Infobox): { html: string; imgId: string | null; search: string } {
    const fieldsHtml = box.fields
      .map(
        (f) =>
          `<tr><th scope="row" class="infobox-label">${escapeHtml(f.label)}</th>` +
          `<td class="infobox-data">${renderInline(f.value)}</td></tr>`
      )
      .join('');

    const id = `iw-img-${++imgCounter}`;
    const imageRow =
      `<tr><td colspan="2" class="infobox-image">` +
      `<img data-img-id="${id}" data-iw-fig="${id}" src="" alt="" width="270" loading="lazy" referrerpolicy="no-referrer" style="max-width:100%;height:auto;">` +
      `<div class="infobox-caption">${renderInline(box.image_caption || '')}</div>` +
      `</td></tr>`;

    const html =
      `<table class="infobox vcard">` +
      `<caption class="infobox-title">${escapeHtml(pendingInfoboxTitle)}</caption>` +
      `<tbody>${imageRow}${fieldsHtml}</tbody>` +
      `</table>`;

    return { html, imgId: id, search: box.image_search || '' };
  }

  function renderSection(sec: Section): { html: string; pendingImages: Array<{ id: string; search: string }> } {
    const level = sec.level === 3 ? 3 : 2;
    const id = headingId(sec.title);
    const tag = level === 3 ? 'h3' : 'h2';
    const headingClass = `mw-heading mw-heading${level}`;
    let html =
      `<div class="${headingClass}">` +
      `<${tag} id="${escapeAttr(id)}">` +
      `<span class="mw-headline" id="${escapeAttr(id)}">${escapeHtml(sec.title)}</span>` +
      `</${tag}>` +
      `</div>`;
    html += renderParagraphs(sec.content);
    const pending: Array<{ id: string; search: string }> = [];
    for (const img of sec.images || []) {
      const fig = buildImageFigure(img);
      html += fig.html;
      pending.push({ id: fig.id, search: img.search });
    }
    return { html, pendingImages: pending };
  }

  function renderReferenceItem(ref: Reference): string {
    return (
      `<li>${escapeHtml(ref.author)} (${escapeHtml(ref.year)}). ` +
      `<i>${escapeHtml(ref.title)}</i>. ` +
      `${escapeHtml(ref.publication)}, ${escapeHtml(ref.pages)}.</li>`
    );
  }

  function renderCategoryItem(cat: Category): string {
    const slug = normalizeSlug(cat.slug.replace(/^\/+/, ''));
    return `<li><a href="/${slug}">${escapeHtml(cat.label)}</a></li>`;
  }

  function handleEvent(e: RenderEvent): void {
    switch (e.type) {
      case 'displayTitle':
        title = e.value;
        pendingInfoboxTitle = e.value;
        titleSubs.forEach((cb) => cb(title));
        break;
      case 'hatnote':
        appendHtml(renderHatnote(e.value));
        break;
      case 'lead':
        appendHtml(renderParagraphs(e.value));
        break;
      case 'infobox': {
        const { html, imgId, search } = renderInfobox(e.value);
        appendHtml(html);
        if (imgId && search) resolveImage(imgId, search);
        break;
      }
      case 'section': {
        if (refsOpen) closeRefs();
        const { html, pendingImages } = renderSection(e.value);
        appendHtml(html);
        for (const p of pendingImages) resolveImage(p.id, p.search);
        break;
      }
      case 'reference': {
        if (!refsOpen) {
          appendHtml(
            `<div class="mw-heading mw-heading2">` +
              `<h2 id="referencias"><span class="mw-headline" id="referencias">Referências</span></h2>` +
              `</div>`
          );
          const ol = document.createElement('ol');
          ol.className = 'references';
          live.appendChild(ol);
          refsListEl = ol;
          refsOpen = true;
        }
        if (refsListEl) appendHtmlTo(refsListEl, renderReferenceItem(e.value));
        break;
      }
      case 'category': {
        if (refsOpen) closeRefs();
        if (!catsOpen) {
          const wrap = document.createElement('div');
          wrap.className = 'catlinks';
          wrap.setAttribute('data-mw', 'interface');
          const inner = document.createElement('div');
          inner.className = 'mw-normal-catlinks';
          inner.innerHTML = `<a href="/category" title="Categorias">Categorias</a>: `;
          const ul = document.createElement('ul');
          inner.appendChild(ul);
          wrap.appendChild(inner);
          live.appendChild(wrap);
          catsListEl = ul;
          catsOpen = true;
        }
        if (catsListEl) appendHtmlTo(catsListEl, renderCategoryItem(e.value));
        break;
      }
    }
  }

  const parser = createParser(handleEvent);

  function onText(chunk: string): void {
    try {
      parser.write(chunk);
    } catch {
      /* malformed partial — ignore */
    }
  }

  function onEnd(): void {
    closeRefs();
    closeCats();
    try {
      parser.end();
    } catch {
      /* tokenizer auto-ends on top-level close; calling end again throws */
    }
  }

  function onTitle(cb: (t: string) => void): () => void {
    titleSubs.add(cb);
    return () => titleSubs.delete(cb);
  }

  function finalHtml(): string {
    const clone = live.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('span.iw-char').forEach((span) => {
      span.replaceWith(document.createTextNode(span.textContent || ''));
    });
    clone.normalize();
    clone.querySelectorAll('img').forEach((img) => {
      img.classList.remove('iw-img-fade');
      img.classList.remove('iw-img-loaded');
      if (img.getAttribute('class') === '') img.removeAttribute('class');
    });
    return clone.innerHTML;
  }

  return {
    live,
    getTitle: () => title,
    onText,
    onEnd,
    onTitle,
    finalHtml,
  };
}
