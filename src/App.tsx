import { useEffect, useRef, useState } from 'react';
import { extractToc, type ParseResult } from './parser';
import { navigate, useRoute } from './router';
import { normalizeSlug } from './slug';
import { getCached, putCached } from './cache';
import { rewriteWikipediaUrls } from './urlRewrite';
import { streamArticle } from './gemini';
import { makeStreamRenderer } from './renderer';
import WikiPage from './WikiPage';
import Home from './Home';

type ViewState =
  | { kind: 'loading' }
  | { kind: 'streaming'; title: string }
  | { kind: 'cached'; result: ParseResult }
  | { kind: 'error'; message: string };

// Module-scope guard so React StrictMode's dev double-mount doesn't kick off two parallel
// Gemini streams for the same slug. Whichever effect-invocation wins gets to drive the
// stream to completion + cache write; the duplicate exits immediately.
const inFlight = new Set<string>();

export default function App() {
  const route = useRoute();
  if (route.kind === 'home') return <Home />;
  return <ArticleView slug={route.slug} />;
}

function ArticleView({ slug }: { slug: string }) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const streamHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setView({ kind: 'loading' });

    (async () => {
      const cached = await getCached(slug);
      if (cancelled) return;

      if (cached) {
        const html = rewriteWikipediaUrls(cached.html);
        setView({
          kind: 'cached',
          result: {
            html,
            displayTitle: cached.displayTitle || slug,
            toc: extractToc(html),
          },
        });
        return;
      }

      const topicFromSession = (() => {
        try {
          return sessionStorage.getItem(`topic:${slug}`) || '';
        } catch {
          return '';
        }
      })();
      const topic = topicFromSession || slug.replace(/-/g, ' ');

      if (inFlight.has(slug)) {
        console.info('[stream] already in flight for', slug, '— skipping duplicate');
        return;
      }
      inFlight.add(slug);

      const renderer = makeStreamRenderer(topic);
      renderer.onTitle((t) => {
        if (cancelled) return;
        setView((v) => (v.kind === 'streaming' ? { kind: 'streaming', title: t } : v));
      });

      setView({ kind: 'streaming', title: topic });

      requestAnimationFrame(() => {
        if (cancelled) return;
        const host = streamHostRef.current;
        if (host) {
          host.innerHTML = '';
          host.appendChild(renderer.live);
        }
      });

      try {
        await streamArticle(topic, renderer.onText);
        renderer.onEnd();
        const finalHtml = renderer.finalHtml();
        const finalTitle = renderer.getTitle() || topic;
        try {
          await putCached(slug, { displayTitle: finalTitle, html: finalHtml });
        } catch (cacheErr) {
          console.error('[cache] write failed for', slug, cacheErr);
        }
        if (cancelled) return;
        const rewritten = rewriteWikipediaUrls(finalHtml);
        setView({
          kind: 'cached',
          result: {
            html: rewritten,
            displayTitle: finalTitle,
            toc: extractToc(rewritten),
          },
        });
      } catch (err) {
        console.error('[stream] failed for', slug, err);
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'erro desconhecido';
        setView({ kind: 'error', message });
      } finally {
        inFlight.delete(slug);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <div className="app">
      <header className="app-header">
        <a
          href="/"
          className="header-logo-link"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <img src="/logo_horizontal.png" alt="InfiniWiki" className="logo" />
        </a>
        <HeaderSearch />
      </header>

      {view.kind === 'loading' && <div className="status-line">Carregando…</div>}

      {view.kind === 'streaming' && (
        <div className="wiki-shell">
          <aside className="wiki-sidebar" aria-label="Conteúdo">
            <nav className="wiki-toc-nav">
              <div className="wiki-toc-header">Conteúdo</div>
              <ul className="wiki-toc-list">
                <li className="wiki-toc-item wiki-toc-level-1">
                  <a href="#firstHeading">(Início)</a>
                </li>
              </ul>
              <div className="status-line">Gerando…</div>
            </nav>
          </aside>
          <main className="wiki-main">
            <article id="content" className="mw-body" role="main">
              <h1 id="firstHeading" className="firstHeading mw-first-heading">
                {view.title}
              </h1>
              <div id="bodyContent" className="mw-body-content">
                <div id="siteSub" className="noprint">
                  Origem: InfiniWiki, a enciclopédia livre.
                </div>
                <div id="mw-content-text" className="mw-content-ltr" lang="pt" dir="ltr">
                  <div ref={streamHostRef} />
                </div>
              </div>
            </article>
          </main>
        </div>
      )}

      {view.kind === 'cached' && (
        <WikiPage
          title={view.result.displayTitle}
          html={view.result.html}
          toc={view.result.toc}
          empty={false}
        />
      )}

      {view.kind === 'error' && (
        <main className="wiki-main">
          <div className="not-found">
            <h1>Falha ao gerar a página</h1>
            <p>
              <code>{view.message}</code>
            </p>
            <p>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/');
                }}
              >
                ← Voltar ao início
              </a>
            </p>
          </div>
        </main>
      )}
    </div>
  );
}

function HeaderSearch() {
  const [q, setQ] = useState('');
  return (
    <form
      className="iw-search"
      onSubmit={(e) => {
        e.preventDefault();
        const topic = q.trim();
        if (!topic) return;
        const slug = normalizeSlug(topic);
        if (!slug) return;
        try {
          sessionStorage.setItem(`topic:${slug}`, topic);
        } catch {
          /* ignore */
        }
        navigate('/' + slug);
      }}
    >
      <div className="iw-search__field">
        <span className="iw-search__icon" aria-hidden="true" />
        <input
          className="iw-search__input"
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar na InfiniWiki"
          aria-label="Pesquisar"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button type="submit" className="iw-search__button">Procurar</button>
    </form>
  );
}
