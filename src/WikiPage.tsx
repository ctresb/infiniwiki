import { useEffect, useRef } from 'react';
import type { TocItem } from './parser';
import { hydrateAudioPlayers } from './audioHydrate';

interface Props {
  title: string;
  html: string;
  toc: TocItem[];
  empty: boolean;
}

export default function WikiPage({ title, html, toc, empty }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current || !html) return;
    const cleanup = hydrateAudioPlayers(contentRef.current);
    return cleanup;
  }, [html]);

  if (empty) {
    return (
      <main className="wiki-main">
        <div className="wiki-empty">No page loaded.</div>
      </main>
    );
  }

  return (
    <div className="wiki-shell">
      <aside className="wiki-sidebar" aria-label="Conteúdo">
        <nav className="wiki-toc-nav" id="mw-panel-toc">
          <div className="wiki-toc-header">Conteúdo</div>
          <ul className="wiki-toc-list">
            <li className="wiki-toc-item wiki-toc-level-1">
              <a href="#firstHeading">(Início)</a>
            </li>
            {toc.map((s, i) => (
              <li
                key={`${s.id}-${i}`}
                className={`wiki-toc-item wiki-toc-level-${s.level}`}
              >
                <a href={`#${s.id}`}>{s.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="wiki-main">
        <article id="content" className="mw-body" role="main">
          <h1
            id="firstHeading"
            className="firstHeading mw-first-heading"
            dangerouslySetInnerHTML={{ __html: title }}
          />
          <div id="bodyContent" className="mw-body-content">
            <div id="siteSub" className="noprint">
              Origem: InfiniWiki, a enciclopédia livre.
            </div>
            <div id="contentSub" />
            <div
              id="mw-content-text"
              className="mw-content-ltr"
              lang="pt"
              dir="ltr"
            >
              <div
                ref={contentRef}
                className="mw-parser-output"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}
