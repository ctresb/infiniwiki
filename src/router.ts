import { useEffect, useState } from 'react';
import { normalizeSlug } from './slug';

export type Route =
  | { kind: 'home' }
  | { kind: 'article'; slug: string };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function getRoute(): Route {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!path) return { kind: 'home' };
  const raw = decode(path.split('/')[0]);
  const slug = normalizeSlug(raw);
  if (!slug) return { kind: 'home' };
  return { kind: 'article', slug };
}

export function navigate(path: string): void {
  const target = path.startsWith('/') ? path : '/' + path;
  if (window.location.pathname === target) return;
  window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => getRoute());
  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

let interceptorInstalled = false;

export function installLinkInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;

  document.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      if (!target) return;
      const anchor = target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (href.startsWith('//')) return;

      const tgt = anchor.getAttribute('target');
      if (tgt && tgt !== '' && tgt !== '_self') return;

      e.preventDefault();
      navigate(href);
    },
    true
  );
}
