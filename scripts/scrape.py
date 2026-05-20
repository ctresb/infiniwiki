#!/usr/bin/env python3
"""
Scrape a live pt.wikipedia.org article for 1:1 offline mirroring.

Outputs to public/:
  - wikipedia.css       all <link rel=stylesheet> bundles concatenated, url() refs absolutized
  - sample.json         { displayTitle, html } — content of <div id="mw-content-text">,
                        which preserves inline <style data-mw-deduplicate> TemplateStyles,
                        TMH player skeletons, Phonos buttons, etc.

Usage:  python3 scripts/scrape.py [article-url]
Default article: https://pt.wikipedia.org/wiki/Brasil
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from html.parser import HTMLParser

DEFAULTS = [("brasil", "https://pt.wikipedia.org/wiki/Brasil")]
WIKI_ORIGIN = "https://pt.wikipedia.org"
OUT_DIR = Path(__file__).resolve().parent.parent / "public"
PAGES_DIR = OUT_DIR / "pages"
UA = "InfiniWiki/0.3 (offline mirror tool)"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def absolutize(url: str, base: str) -> str:
    if url.startswith("data:") or url.startswith("blob:"):
        return url
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return WIKI_ORIGIN + url
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urllib.parse.urljoin(base, url)


URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)")
IMPORT_RE = re.compile(
    r"@import\s+(?:url\()?\s*['\"]?([^'\")\s;]+)['\"]?\s*\)?\s*;"
)


def rewrite_css(css: str, base_url: str) -> str:
    def repl(m: re.Match) -> str:
        q = m.group(1)
        u = m.group(2).strip()
        if u.startswith("data:"):
            return m.group(0)
        return f"url({q}{absolutize(u, base_url)}{q})"

    return URL_RE.sub(repl, css)


def inline_imports(css: str, base_url: str, depth: int = 0) -> str:
    if depth > 4:
        return css

    def repl(m: re.Match) -> str:
        url = absolutize(m.group(1).strip(), base_url)
        try:
            sub = fetch(url)
        except Exception as e:
            print(f"  !! import fail {url}: {e}", file=sys.stderr)
            return ""
        sub = inline_imports(sub, url, depth + 1)
        sub = rewrite_css(sub, url)
        return f"\n/* --- inlined @import {url} --- */\n{sub}\n"

    return IMPORT_RE.sub(repl, css)


class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = dict(attrs)
        rel = (a.get("rel") or "").lower()
        if "stylesheet" not in rel:
            return
        href = a.get("href")
        if href:
            self.links.append(href)


def scrape_css(article_html: str, article_url: str) -> None:
    p = LinkExtractor()
    p.feed(article_html)
    print(f"Found {len(p.links)} <link rel=stylesheet> refs")

    # Extra modules that are loaded by JS, never in <link> tags
    extra_modules = [
        "ext.tmh.player.styles",
        "ext.tmh.player",
        "mediawiki.page.gallery.styles",
        "mediawiki.toc.styles",
        "ext.phonos.styles",
        "ext.kartographer.style",
        "ext.kartographer.link",
        "ext.kartographer.frame",
        "oojs-ui.styles.icons-media",
        "oojs-ui.styles.icons-content",
        "oojs-ui.styles.icons-interactions",
        "oojs-ui.styles.indicators",
        # Codex (used by Vector-2022 header search)
        "@wikimedia/codex-search/codex-search.style",
        "skins.vector.search.codex.styles",
        "skins.vector.styles",
        "skins.vector.icons",
    ]
    extra = (
        f"{WIKI_ORIGIN}/w/load.php?lang=pt&modules="
        + "%7C".join(extra_modules)
        + "&only=styles&skin=vector-2022"
    )
    all_urls = [absolutize(h, article_url) for h in p.links] + [extra]
    seen: set[str] = set()
    chunks: list[str] = []
    for url in all_urls:
        if url in seen:
            continue
        seen.add(url)
        print(f"  fetch {url[:140]}")
        try:
            css = fetch(url)
        except Exception as e:
            print(f"  !! fail: {e}", file=sys.stderr)
            continue
        css = inline_imports(css, url)
        css = rewrite_css(css, url)
        chunks.append(f"/* ===== {url} ===== */\n{css}\n")

    out = "\n".join(chunks)
    (OUT_DIR / "wikipedia.css").write_text(out, encoding="utf-8")
    print(f"Wrote public/wikipedia.css ({len(out):,} chars)")


# ----- content extraction -----

class ContentExtractor(HTMLParser):
    """Find the <div id="mw-content-text"> element and capture its inner HTML.

    Also captures the firstHeading text from <h1 id="firstHeading"> (or the
    nested .mw-page-title-main span when present).

    Records the raw source slice so we keep all inline <style> blocks,
    attributes, and weird OOUI markup byte-for-byte.
    """

    def __init__(self, src: str):
        super().__init__(convert_charrefs=False)
        self.src = src
        self.depth = 0
        self.in_content = False
        self.content_start_offset = -1
        self.content_end_offset = -1
        self.content_depth = 0
        # Heading
        self.in_h1 = False
        self.h1_depth = 0
        self.h1_buf: list[str] = []
        self.display_title = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if not self.in_content:
            if tag == "div" and a.get("id") == "mw-content-text":
                self.in_content = True
                self.content_depth = 1
                # The content we want is the INNER HTML, so start after this tag.
                self.content_start_offset = self.getpos_offset()
                # Move past current tag — we want offset of next char after '>'
                # but HTMLParser doesn't expose that, so we'll trim the opening
                # tag manually later using regex search.
                return
            if tag == "h1" and a.get("id") == "firstHeading":
                self.in_h1 = True
                self.h1_depth = 1
                return
            return

        # Inside content
        if tag == "div":
            self.content_depth += 1

    def handle_endtag(self, tag):
        if self.in_h1:
            if tag == "h1":
                self.h1_depth -= 1
                if self.h1_depth <= 0:
                    self.in_h1 = False
                    self.display_title = "".join(self.h1_buf).strip()
                    self.h1_buf = []
                    return
        if self.in_content and tag == "div":
            self.content_depth -= 1
            if self.content_depth <= 0:
                self.in_content = False
                self.content_end_offset = self.getpos_offset()

    def handle_data(self, data):
        if self.in_h1:
            self.h1_buf.append(data)

    def getpos_offset(self) -> int:
        line, col = self.getpos()
        # Convert (line, col) to absolute offset in source
        idx = 0
        cur = 1
        while cur < line:
            nxt = self.src.find("\n", idx)
            if nxt == -1:
                break
            idx = nxt + 1
            cur += 1
        return idx + col


def extract_content(article_html: str) -> tuple[str, str]:
    """Return (display_title, inner_html_of_mw_content_text)."""
    # Easier: regex-find the div, then balance-match.
    m = re.search(
        r'<div\b[^>]*\bid="mw-content-text"[^>]*>',
        article_html,
        re.IGNORECASE,
    )
    if not m:
        raise RuntimeError("Could not locate #mw-content-text")
    start = m.end()
    depth = 1
    i = start
    div_open_re = re.compile(r"<div\b", re.IGNORECASE)
    div_close_re = re.compile(r"</div\s*>", re.IGNORECASE)
    while depth > 0 and i < len(article_html):
        open_m = div_open_re.search(article_html, i)
        close_m = div_close_re.search(article_html, i)
        if not close_m:
            break
        if open_m and open_m.start() < close_m.start():
            depth += 1
            i = open_m.end()
        else:
            depth -= 1
            i = close_m.end()
            if depth == 0:
                inner = article_html[start : close_m.start()]
                # Title
                h1 = re.search(
                    r'<h1\b[^>]*\bid="firstHeading"[^>]*>(.*?)</h1>',
                    article_html,
                    re.IGNORECASE | re.DOTALL,
                )
                title_html = h1.group(1) if h1 else ""
                # Title may contain <span class="mw-page-title-main">…</span>
                mt = re.search(
                    r'class="mw-page-title-main"[^>]*>([^<]+)<',
                    title_html,
                )
                if mt:
                    title = mt.group(1).strip()
                else:
                    title = re.sub(r"<[^>]+>", "", title_html).strip()
                return title, inner
    raise RuntimeError("Could not balance #mw-content-text closing tag")


AUDIO_TAG_RE = re.compile(
    r'<audio\b([^>]*\bdata-mw-tmh\b[^>]*)>(.*?)</audio>',
    re.IGNORECASE | re.DOTALL,
)
ATTR_RE = re.compile(r'(\w[\w:-]*)\s*=\s*"([^"]*)"')


def fmt_duration(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def spoken_duration_pt(seconds: float) -> str:
    s = int(round(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    parts: list[str] = []
    if h:
        parts.append(f"{h} hora" + ("s" if h != 1 else ""))
    if m:
        parts.append(f"{m} minuto" + ("s" if m != 1 else ""))
    if sec:
        parts.append(f"{sec} segundo" + ("s" if sec != 1 else ""))
    if not parts:
        return "0 segundos"
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " e " + parts[-1]


def wrap_tmh_audio(html: str) -> str:
    """Wrap <audio data-mw-tmh> elements in the .mw-tmh-player skeleton that
    ext.tmh.player.js would normally inject at runtime."""

    def repl(m: re.Match) -> str:
        attrs_raw = m.group(1)
        inner = m.group(2)
        attrs = dict(ATTR_RE.findall(attrs_raw))
        width = attrs.get("width") or "250"
        try:
            width_int = int(re.sub(r"\D", "", width) or "250")
        except ValueError:
            width_int = 250
        title_attr = attrs.get("data-mwtitle") or ""
        href = (
            f"//pt.wikipedia.org/wiki/Ficheiro:{urllib.parse.quote(title_attr)}"
            if title_attr
            else "#"
        )
        try:
            duration = float(attrs.get("data-durationhint") or "0")
        except ValueError:
            duration = 0.0
        dur_label = fmt_duration(duration) if duration > 0 else ""
        sr_label = (
            f"Duração: {spoken_duration_pt(duration)}." if duration > 0 else ""
        )
        # Rebuild the <audio> tag, force preload=none, no controls
        clean_attrs = (
            f' preload="none" data-mw-tmh="" height="32" width="{width_int}"'
            f' style="width: {width_int}px;"'
            f' resource="//pt.wikipedia.org/wiki/Ficheiro:{urllib.parse.quote(title_attr)}"'
            f' data-durationhint="{attrs.get("data-durationhint", "")}"'
            f' class="" playsinline=""'
            f' disabled="disabled" tabindex="-1"'
        )
        # keep <source> / <track> children inside the audio so playback works when JS hydrates
        new_audio = f"<audio{clean_attrs}>{inner}</audio>"
        duration_block = (
            f'<span class="mw-tmh-duration mw-tmh-label">'
            f'<span class="sr-only">{sr_label}</span>'
            f'<span aria-hidden="true">{dur_label}</span>'
            f"</span>"
            if dur_label
            else ""
        )
        return (
            f'<span class="mw-tmh-player audio mw-file-element"'
            f' style="width: {width_int}px;">'
            f"{new_audio}"
            f'<a class="mw-tmh-play" href="{href}"'
            f' title="Reproduzir áudio" role="button">'
            f'<span class="mw-tmh-play-icon notheme"></span>'
            f"</a>"
            f"{duration_block}"
            f"</span>"
        )

    return AUDIO_TAG_RE.sub(repl, html)


def scrape_page(slug: str, article_url: str) -> str:
    print(f"Fetching article HTML: {article_url}")
    html = fetch(article_url)
    title, content = extract_content(html)
    content = wrap_tmh_audio(content)
    out = {"displayTitle": title, "html": content}
    PAGES_DIR.mkdir(parents=True, exist_ok=True)
    (PAGES_DIR / f"{slug}.json").write_text(
        json.dumps(out, ensure_ascii=False), encoding="utf-8"
    )
    print(
        f"Wrote public/pages/{slug}.json (title={title!r}, {len(content):,} chars HTML)"
    )
    return html


def slug_from_url(url: str) -> str:
    m = re.search(r"/wiki/([^?#]+)", url)
    if not m:
        return "page"
    return urllib.parse.unquote(m.group(1)).lower().replace(" ", "_")


def main() -> int:
    if len(sys.argv) >= 3:
        targets = [(sys.argv[1], sys.argv[2])]
    elif len(sys.argv) == 2:
        url = sys.argv[1]
        targets = [(slug_from_url(url), url)]
    else:
        targets = DEFAULTS

    last_html = ""
    last_url = ""
    for slug, url in targets:
        last_html = scrape_page(slug, url)
        last_url = url
    if last_html:
        scrape_css(last_html, last_url)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
