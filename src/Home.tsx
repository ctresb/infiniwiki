import { useState } from 'react';
import { navigate } from './router';
import { normalizeSlug } from './slug';

export default function Home() {
  const [query, setQuery] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const topic = query.trim();
    if (!topic) return;
    const slug = normalizeSlug(topic);
    if (!slug) return;
    try {
      sessionStorage.setItem(`topic:${slug}`, topic);
    } catch {
      /* ignore quota */
    }
    navigate('/' + slug);
  }

  return (
    <div className="home">
      <div className="home-inner">
        <img src="/logo_text.png" alt="InfiniWiki" className="home-wordmark" />
        <img src="/favicon.png" alt="" className="home-favicon" />

        <form className="home-search" onSubmit={submit}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar na InfiniWiki"
            autoFocus
            aria-label="Buscar"
          />
          <button type="submit" aria-label="Buscar">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.4">
              <circle cx="9" cy="9" r="6" />
              <line x1="13.5" y1="13.5" x2="20" y2="20" strokeLinecap="round" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
