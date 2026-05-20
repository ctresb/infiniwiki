// Hydrate Wikipedia TMH player and Phonos buttons. Clicking opens a
// Wikipedia-style modal dialog with a video.js player inside.

import videojs from 'video.js';
import 'video.js/dist/video-js.css';

interface AudioSource {
  src: string;
  type: string;
}

function abs(url: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

function openDialog(sources: AudioSource[], title: string): void {
  if (!sources.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'iw-tmh-overlay';
  overlay.innerHTML = `
    <div class="iw-tmh-dialog oo-ui-window oo-ui-window-active oo-ui-dialog oo-ui-processDialog" role="dialog">
      <div class="oo-ui-window-content oo-ui-dialog-content oo-ui-processDialog-content oo-ui-window-content-setup oo-ui-window-content-ready">
        <div class="oo-ui-window-head">
          <div class="oo-ui-processDialog-navigation">
            <div class="oo-ui-processDialog-actions-primary"></div>
            <div class="oo-ui-processDialog-location" style="padding-left:46px;padding-right:46px;">
              <label class="oo-ui-widget oo-ui-widget-enabled oo-ui-labelElement-label oo-ui-labelWidget oo-ui-processDialog-title oo-ui-labelElement"></label>
            </div>
            <div class="iw-tmh-close-wrap">
              <button type="button" class="iw-tmh-close" title="Fechar o leitor de multimédia" aria-label="Fechar">
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.6l4.3-4.3a1 1 0 0 1 1.4 1.4L11.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 0 1-1.4-1.4L8.6 10 4.3 5.7a1 1 0 0 1 0-1.4z" fill="#54595d"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div class="oo-ui-window-body">
          <div class="oo-ui-layout oo-ui-panelLayout oo-ui-panelLayout-expanded">
            <video class="video-js vjs-default-skin vjs-audio" controls preload="auto" playsinline></video>
          </div>
        </div>
        <div class="oo-ui-window-foot"></div>
      </div>
    </div>`;
  overlay.querySelector('.oo-ui-processDialog-title')!.textContent = title;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const videoEl = overlay.querySelector<HTMLVideoElement>('video')!;
  const player = videojs(videoEl, {
    autoplay: true,
    controls: true,
    preload: 'auto',
    audioOnlyMode: true,
    fluid: false,
    fill: false,
    sources: sources.map((s) => ({ src: abs(s.src), type: s.type })),
  } as any);

  const close = () => {
    try {
      player.dispose();
    } catch {}
    overlay.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  overlay.querySelector('.iw-tmh-close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
}

function collectTmhSources(audio: HTMLAudioElement): AudioSource[] {
  const out: AudioSource[] = [];
  audio.querySelectorAll('source').forEach((s) => {
    const src = s.getAttribute('src');
    const type = s.getAttribute('type') || '';
    if (src) out.push({ src, type });
  });
  // Fallback to audio[src] itself
  const direct = audio.getAttribute('src');
  if (!out.length && direct) out.push({ src: direct, type: '' });
  return out;
}

export function hydrateAudioPlayers(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];

  // ----- TMH players -----
  root.querySelectorAll<HTMLElement>('.mw-tmh-player').forEach((wrapper) => {
    const audio = wrapper.querySelector<HTMLAudioElement>('audio');
    const playBtn = wrapper.querySelector<HTMLAnchorElement>('.mw-tmh-play');
    if (!audio || !playBtn) return;

    const sources = collectTmhSources(audio);
    const title =
      audio.getAttribute('data-mwtitle') ||
      (audio.getAttribute('resource') || '').split(':').pop() ||
      'Áudio';

    const onClick = (e: Event) => {
      e.preventDefault();
      openDialog(sources, decodeURIComponent(title));
    };
    playBtn.addEventListener('click', onClick);
    cleanups.push(() => playBtn.removeEventListener('click', onClick));
  });

  // ----- Phonos buttons -----
  root.querySelectorAll<HTMLElement>('.ext-phonos-PhonosButton').forEach((btn) => {
    const link = btn.querySelector<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const rawHref =
      link.getAttribute('data-orig-href') || link.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('javascript:')) return;
    const label =
      btn.querySelector('.oo-ui-labelElement-label')?.textContent?.trim() ||
      'Áudio';

    const onClick = (e: Event) => {
      e.preventDefault();
      const src = abs(rawHref);
      const type = src.endsWith('.mp3')
        ? 'audio/mpeg'
        : src.endsWith('.ogg')
          ? 'audio/ogg'
          : '';
      openDialog([{ src, type }], label);
    };
    link.addEventListener('click', onClick);
    cleanups.push(() => link.removeEventListener('click', onClick));
  });

  return () => cleanups.forEach((f) => f());
}
