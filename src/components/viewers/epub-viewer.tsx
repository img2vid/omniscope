"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip,
  ToolbarSelect,
} from "./viewer-ui";
import { cn, clamp, formatBytes } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, ListTree, BookOpen,
} from "lucide-react";

const IMG_BYTE_CAP = 64 * 1024 * 1024;
const DOMPURIFY_URI = /^(?:(?:https?|mailto|tel|callto|sms|cid|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

interface ManifestItem { id: string; href: string; mediaType: string; absPath: string }
interface Chapter { index: number; absPath: string; title: string }

interface EpubBook {
  title: string;
  creator: string;
  language: string;
  chapters: Chapter[];
  manifestById: Record<string, ManifestItem>;
  zip: Record<string, Uint8Array>;
  baseDir: string;
}

/* ------------------------------ helpers ------------------------------ */

function byLocal(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function resolveZipPath(baseDir: string, href: string): string {
  let h = href.split("#")[0].trim();
  if (!h) return "";
  h = h.replace(/\\/g, "/");
  const isAbs = h.startsWith("/");
  const parts = (isAbs ? h.slice(1) : baseDir ? baseDir + "/" + h : h).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** look a path up in the zip, falling back to basename matching */
function zipLookup(zip: Record<string, Uint8Array>, path: string): { key: string; data: Uint8Array } | null {
  if (!path) return null;
  const norm = path.replace(/^\.\//, "").replace(/^\//, "");
  const direct = Object.keys(zip).find((k) => k === norm || k === "./" + norm);
  if (direct) return { key: direct, data: zip[direct] };
  const base = norm.split("/").pop() ?? norm;
  for (const k of Object.keys(zip)) {
    if (k.split("/").pop() === base) return { key: k, data: zip[k] };
  }
  return null;
}

function isHtmlChapter(item: ManifestItem | undefined): boolean {
  if (!item) return false;
  const mt = (item.mediaType || "").toLowerCase();
  if (mt.includes("html") || mt.includes("xhtml")) return true;
  return /\.(x?html?|htm)$/i.test(item.absPath);
}

function parseXmlOrHtml(str: string): Document {
  const asXml = new DOMParser().parseFromString(str, "application/xml");
  if (!byLocal(asXml, "parsererror").length) return asXml;
  return new DOMParser().parseFromString(str, "text/html");
}

function textOfFirst(root: Element | Document, local: string): string {
  const el = byLocal(root, local)[0];
  return el?.textContent?.trim() ?? "";
}

/* ------------------------------ component ------------------------------ */

export default function EpubViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [book, setBook] = React.useState<EpubBook | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [chapterIdx, setChapterIdx] = React.useState(0);
  const [chapterHtml, setChapterHtml] = React.useState<string | null>(null);
  const [fontSize, setFontSize] = React.useState<"s" | "m" | "l">("m");
  const [showToc, setShowToc] = React.useState(false);
  const [chapterError, setChapterError] = React.useState<string | null>(null);

  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const blobUrlsRef = React.useRef<string[]>([]);

  /* ---------------- parse the package ---------------- */
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setBook(null);
      setError(null);
      try {
        if (!arrayBuffer) {
          setError({
            message: "This EPUB exceeds the in-memory load cap (96 MB).",
            hint: "Extract or split the book before loading, or inspect it with the archive viewer.",
          });
          return;
        }
        const { unzipSync, strFromU8 } = await import("fflate");
        const zip = unzipSync(new Uint8Array(arrayBuffer));
        if (cancelled) return;
        // 1. container.xml → rootfile
        let opfPath = "";
        const container = zipLookup(zip, "META-INF/container.xml");
        if (container) {
          const cdoc = parseXmlOrHtml(strFromU8(container.data));
          const rootfile = byLocal(cdoc, "rootfile")[0];
          opfPath = rootfile?.getAttribute("full-path") ?? "";
        }
        if (!opfPath) {
          const guess = Object.keys(zip).find((k) => /\.opf$/i.test(k));
          if (!guess) throw new Error("no .opf package document found in this EPUB");
          opfPath = guess;
        }
        const opfData = zipLookup(zip, opfPath);
        if (!opfData) throw new Error(`package document “${opfPath}” is missing from the archive`);
        const opf = parseXmlOrHtml(strFromU8(opfData.data));
        const baseDir = dirname(opfData.key);

        // 2. manifest
        const manifestById: Record<string, ManifestItem> = {};
        for (const item of byLocal(opf, "item")) {
          const id = item.getAttribute("id") ?? "";
          const href = item.getAttribute("href") ?? "";
          if (!id || !href) continue;
          manifestById[id] = {
            id,
            href,
            mediaType: item.getAttribute("media-type") ?? "",
            absPath: resolveZipPath(baseDir, href),
          };
        }

        // 3. spine
        const spineIds: string[] = [];
        for (const ref of byLocal(opf, "itemref")) {
          const idref = ref.getAttribute("idref");
          if (idref) spineIds.push(idref);
        }
        let chapterItems = spineIds.map((id) => manifestById[id]).filter((it) => isHtmlChapter(it));
        if (!chapterItems.length) {
          chapterItems = Object.values(manifestById).filter((it) => isHtmlChapter(it));
        }
        if (!chapterItems.length) throw new Error("the spine contains no readable (X)HTML documents");

        const chapters: Chapter[] = chapterItems.map((it, i) => ({
          index: i,
          absPath: it.absPath,
          title: `Chapter ${i + 1}`,
        }));
        const byPath = new Map<string, Chapter>();
        for (const ch of chapters) {
          if (!byPath.has(ch.absPath)) byPath.set(ch.absPath, ch);
        }

        // 4. metadata
        const metaEl = byLocal(opf, "metadata")[0] ?? opf;
        const title = textOfFirst(metaEl, "title") || fileName.replace(/\.\w+$/, "");
        const creator = textOfFirst(metaEl, "creator");
        const language = textOfFirst(metaEl, "language");

        // 5. TOC — EPUB3 nav document first, then NCX
        const applyToc = (href: string, label: string, fromDir: string) => {
          const abs = resolveZipPath(fromDir, href);
          const ch = byPath.get(abs);
          if (ch && !ch.title.startsWith("Chapter ")) return; // first assignment wins
          if (ch && label) ch.title = label.slice(0, 90);
        };
        const navSpineItem = byLocal(opf, "item").find((it) => (it.getAttribute("properties") ?? "").split(/\s+/).includes("nav"));
        const navDocItem = Object.values(manifestById).find((it) => /nav/i.test(it.id) && /x?html/i.test(it.mediaType));
        const navCandidates = [navSpineItem ? resolveZipPath(baseDir, navSpineItem.getAttribute("href") ?? "") : "", navDocItem?.absPath ?? ""].filter(Boolean);
        let tocParsed = false;
        for (const cand of navCandidates) {
          const entry = zipLookup(zip, cand);
          if (!entry) continue;
          const navDoc = parseXmlOrHtml(strFromU8(entry.data));
          const anchors = byLocal(navDoc, "a");
          if (!anchors.length) continue;
          const navDir = dirname(entry.key);
          for (const a of anchors) {
            const href = a.getAttribute("href") ?? "";
            const label = (a.textContent ?? "").trim();
            if (href && label && !/^([a-z]+:)?\/\//i.test(href) && !href.startsWith("#")) {
              applyToc(href, label, navDir);
            }
          }
          tocParsed = true;
          break;
        }
        if (!tocParsed) {
          const ncxItem = Object.values(manifestById).find((it) => /dtbncx/i.test(it.mediaType));
          const ncxEntry = ncxItem ? zipLookup(zip, ncxItem.absPath) : zipLookup(zip, "toc.ncx");
          if (ncxEntry) {
            const ncxDoc = parseXmlOrHtml(strFromU8(ncxEntry.data));
            const ncxDir = dirname(ncxEntry.key);
            for (const np of byLocal(ncxDoc, "navPoint")) {
              const label = textOfFirst(np, "text");
              const src = byLocal(np, "content")[0]?.getAttribute("src") ?? "";
              if (label && src) applyToc(src, label, ncxDir);
            }
          }
        }

        if (cancelled) return;
        setBook({ title, creator, language, chapters, manifestById, zip, baseDir });
        setChapterIdx(0);
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "The EPUB structure could not be parsed. It may be corrupt, DRM-protected (Adobe/Kindle DRM), or not an EPUB at all.",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, fileName]);

  /* ---------------- render current chapter ---------------- */
  React.useEffect(() => {
    if (!book) return;
    let cancelled = false;
    // release the previous chapter's blob URLs and own a fresh array for this run
    blobUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    const urls: string[] = [];
    blobUrlsRef.current = urls;
    setChapterHtml(null);
    setChapterError(null);
    (async () => {
      try {
        const chapter = book.chapters[Math.min(chapterIdx, book.chapters.length - 1)];
        const entry = zipLookup(book.zip, chapter.absPath);
        if (!entry) throw new Error(`missing chapter file: ${chapter.absPath}`);
        const { strFromU8 } = await import("fflate");
        const doc = parseXmlOrHtml(strFromU8(entry.data));
        const chapterDir = dirname(entry.key);
        let imgBudget = IMG_BYTE_CAP;

        // rewrite images to blob URLs (remote http(s)/data images are left as-is)
        const imgLikes: Element[] = [
          ...byLocal(doc, "img").filter((el) => el.getAttribute("src")),
          ...byLocal(doc, "image"),
        ];
        for (const el of imgLikes) {
          const rawHref = el.getAttribute("src") ?? el.getAttribute("xlink:href") ?? el.getAttribute("href") ?? "";
          if (!rawHref || /^([a-z]+:)?\/\//i.test(rawHref) || rawHref.startsWith("data:")) continue;
          const abs = resolveZipPath(chapterDir, rawHref);
          const imgEntry = zipLookup(book.zip, abs);
          if (!imgEntry) {
            el.parentNode?.removeChild(el);
            continue;
          }
          if (imgEntry.data.length > imgBudget) continue;
          imgBudget -= imgEntry.data.length;
          const type = /\.(png)$/i.test(imgEntry.key) ? "image/png"
            : /\.(jpe?g)$/i.test(imgEntry.key) ? "image/jpeg"
            : /\.(gif)$/i.test(imgEntry.key) ? "image/gif"
            : /\.(svg)$/i.test(imgEntry.key) ? "image/svg+xml"
            : /\.(webp)$/i.test(imgEntry.key) ? "image/webp" : "";
          const url = URL.createObjectURL(new Blob([imgEntry.data as unknown as BlobPart], { type: type || "application/octet-stream" }));
          urls.push(url);
          const img = doc.createElement("img");
          img.setAttribute("src", url);
          img.setAttribute("alt", el.getAttribute("alt") ?? el.getAttribute("xlink:title") ?? "");
          el.parentNode?.replaceChild(img, el);
        }

        // serialize body → sanitize
        const bodyEl = byLocal(doc, "body")[0] ?? doc.documentElement;
        const inner = bodyEl ? bodyEl.innerHTML : "";
        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(inner, {
          FORBID_TAGS: ["script", "style", "link", "meta", "iframe", "form", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
          ALLOWED_URI_REGEXP: DOMPURIFY_URI,
        });
        if (cancelled) return; // cleanup below already revoked this run's URLs
        setChapterHtml(clean || "<p class='text-zinc-600'>(this chapter has no content)</p>");
      } catch (e: any) {
        if (!cancelled) setChapterError(String(e?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (blobUrlsRef.current === urls) blobUrlsRef.current = [];
    };
  }, [book, chapterIdx]);

  // scroll to top on chapter change
  React.useEffect(() => {
    if (chapterHtml && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [chapterHtml]);

  /* ---------------- link interception ---------------- */
  const onContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement)?.closest?.("a");
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#") && href.length > 1) {
      const id = decodeURIComponent(href.slice(1));
      const target = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (book && !/^([a-z]+:)?\/\//i.test(href)) {
      const chapterDir = dirname(current.absPath);
      const abs = resolveZipPath(chapterDir, href);
      const idx = book.chapters.findIndex((c) => c.absPath === abs);
      if (idx >= 0) setChapterIdx(idx);
    }
  };

  if (error) return <ErrorCard title="Cannot open this EPUB" message={error.message} hint={error.hint} />;

  if (!book) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">EPUB</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Opening book…" />
      </div>
    );
  }

  const total = book.chapters.length;
  const current = book.chapters[Math.min(chapterIdx, total - 1)];
  const progress = Math.round(((chapterIdx + 1) / total) * 100);
  const fontPx = fontSize === "s" ? 15 : fontSize === "m" ? 17 : 19;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">EPUB</Chip>
            <ToolbarDivider />
            <ToolButton label="Prev" disabled={chapterIdx <= 0} onClick={() => setChapterIdx((i) => Math.max(0, i - 1))}><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Next" disabled={chapterIdx >= total - 1} onClick={() => setChapterIdx((i) => Math.min(total - 1, i + 1))}><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
            <ToolbarDivider />
            <ToolbarSelect
              label="Ch."
              value={String(chapterIdx)}
              onChange={(v) => setChapterIdx(clamp(parseInt(v, 10) || 0, 0, total - 1))}
              options={book.chapters.slice(0, 400).map((c) => ({ value: String(c.index), label: `${c.index + 1}. ${c.title.slice(0, 44)}` }))}
            />
          </>
        }
        center={
          <div className="hidden items-center gap-1.5 sm:flex">
            <button
              type="button"
              onClick={() => setFontSize("s")}
              className={cn("rounded px-2 py-1 text-[10px] font-semibold", fontSize === "s" ? "bg-emerald-900/60 text-emerald-200" : "text-zinc-500 hover:text-zinc-200")}
              title="Small text"
            >
              S
            </button>
            <button
              type="button"
              onClick={() => setFontSize("m")}
              className={cn("rounded px-2 py-1 text-xs font-semibold", fontSize === "m" ? "bg-emerald-900/60 text-emerald-200" : "text-zinc-500 hover:text-zinc-200")}
              title="Medium text"
            >
              M
            </button>
            <button
              type="button"
              onClick={() => setFontSize("l")}
              className={cn("rounded px-2 py-1 text-sm font-semibold", fontSize === "l" ? "bg-emerald-900/60 text-emerald-200" : "text-zinc-500 hover:text-zinc-200")}
              title="Large text"
            >
              L
            </button>
            <span className="ml-2 font-mono text-[10px] text-zinc-500">{progress}%</span>
          </div>
        }
        right={
          <ToolButton active={showToc} label="Contents" onClick={() => setShowToc((s) => !s)} title="Table of contents"><ListTree className="h-3.5 w-3.5" /></ToolButton>
        }
      />

      {/* progress bar */}
      <div className="h-0.5 shrink-0 bg-zinc-800">
        <div className="h-full bg-emerald-500/80 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex min-h-0 flex-1">
        {showToc ? (
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/60 p-3 scrollbar-thin md:block" aria-label="Table of contents">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <BookOpen className="h-3.5 w-3.5" /> Contents
            </div>
            {book.chapters.map((c) => (
              <button
                key={c.index}
                type="button"
                onClick={() => setChapterIdx(c.index)}
                className={cn(
                  "mb-0.5 block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors",
                  c.index === chapterIdx ? "bg-emerald-900/30 text-emerald-200" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                )}
                title={c.title}
              >
                {c.title}
              </button>
            ))}
          </nav>
        ) : null}

        <ViewerBody scrollRef={bodyRef} className="bg-zinc-950/70">
          <div className="mx-auto max-w-2xl px-6 py-10">
            {chapterError ? (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-300">
                This chapter could not be rendered ({chapterError}). Try the next one.
              </div>
            ) : chapterHtml === null ? (
              <div className="flex items-center gap-2 py-16 text-sm text-zinc-500">
                <BookOpen className="h-4 w-4 animate-pulse text-emerald-400" />
                Rendering chapter…
              </div>
            ) : (
              <div
                ref={contentRef}
                onClick={onContentClick}
                className="epub-body"
                style={{ fontSize: `${fontPx}px` }}
                dangerouslySetInnerHTML={{ __html: chapterHtml }}
              />
            )}
          </div>
        </ViewerBody>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {book.title}
          {book.creator ? <span className="text-zinc-600"> · {book.creator}</span> : null}
        </span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          chapter {chapterIdx + 1} / {total} · {formatBytes(file.size)} · {detected.name}
        </span>
      </div>

      <style>{`
        .epub-body { color: #d6d3d1; font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; }
        .epub-body p { margin: 0.75em 0; text-align: justify; hyphens: auto; }
        .epub-body h1, .epub-body h2, .epub-body h3, .epub-body h4 { color: #f5f5f4; font-weight: 600; margin: 1.2em 0 0.5em; line-height: 1.35; }
        .epub-body h1 { font-size: 1.6em; } .epub-body h2 { font-size: 1.35em; } .epub-body h3 { font-size: 1.15em; }
        .epub-body a { color: #34d399; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
        .epub-body em { color: #e7e5e4; } .epub-body strong { color: #fafaf9; }
        .epub-body hr { border: 0; border-top: 1px solid #2c2c33; margin: 1.8em 0; }
        .epub-body img { max-width: 100%; height: auto; margin: 0.6em auto; border-radius: 4px; }
        .epub-body blockquote { border-left: 3px solid #065f46; padding: 0.2em 1em; margin: 0.8em 0; color: #a8a29e; background: rgba(6,95,70,0.08); }
        .epub-body ul { list-style: disc; padding-left: 1.5em; margin: 0.6em 0; }
        .epub-body ol { list-style: decimal; padding-left: 1.5em; margin: 0.6em 0; }
        .epub-body li { margin: 0.25em 0; }
        .epub-body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.9em; }
        .epub-body td, .epub-body th { border: 1px solid #2c2c33; padding: 4px 8px; }
        .epub-body pre { background: #101013; border: 1px solid #2c2c33; border-radius: 6px; padding: 12px; overflow-x: auto; font-size: 0.85em; }
      `}</style>
    </div>
  );
}
