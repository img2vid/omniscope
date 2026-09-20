"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip,
} from "./viewer-ui";
import { cn, clamp, downloadBlob, formatBytes } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, RotateCw, Search, Download,
  FileText, PanelLeft, X, AlertTriangle,
} from "lucide-react";


const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const THUMB_CAP = 120;
const MATCH_CAP = 300;

interface SearchMatch { page: number; snippet: string; }

export default function PdfViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [doc, setDoc] = React.useState<any>(null);
  const [numPages, setNumPages] = React.useState(0);
  const [meta, setMeta] = React.useState<{ title?: string; author?: string }>({});
  const [baseDim, setBaseDim] = React.useState<{ w: number; h: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [streamed, setStreamed] = React.useState(false);

  const [page, setPage] = React.useState(1);
  const [zoomMode, setZoomMode] = React.useState<"fit" | number>("fit");
  const [fitScale, setFitScale] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [showThumbs, setShowThumbs] = React.useState(false);
  const [visiblePages, setVisiblePages] = React.useState<Set<number>>(new Set());
  const [pageDims, setPageDims] = React.useState<Record<number, { w: number; h: number }>>({});

  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<SearchMatch[] | null>(null);
  const [searchProgress, setSearchProgress] = React.useState<string | null>(null);
  const [activeMatch, setActiveMatch] = React.useState(-1);
  const [flashPage, setFlashPage] = React.useState<number | null>(null);

  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const ioRef = React.useRef<IntersectionObserver | null>(null);
  const pageElsRef = React.useRef<Map<number, HTMLDivElement>>(new Map());

  const scale = zoomMode === "fit" ? fitScale : zoomMode;

  /* ------------------------------ load document ------------------------------ */
  React.useEffect(() => {
    let cancelled = false;
    let task: any = null;
    (async () => {
      setLoading(true);
      setError(null);
      setHint(null);
      try {
        let buf = arrayBuffer;
        if (!buf) {
          // > load cap: try streaming straight from the File object
          buf = await file.arrayBuffer();
          if (!cancelled) setStreamed(true);
        }
        const pdfjs: any = await import("pdfjs-dist");
        const lib = pdfjs.GlobalWorkerOptions ? pdfjs : pdfjs.default;
        lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(buf).slice(); // copy: pdf.js transfers the buffer
        task = lib.getDocument({ data });
        const pdf: any = await task.promise;
        if (cancelled) return;
        setDoc(pdf);
        setNumPages(pdf.numPages);
        const p1 = await pdf.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        if (!cancelled) {
          setBaseDim({ w: vp.width, h: vp.height });
          setPageDims({ 1: { w: vp.width, h: vp.height } });
        }
        try {
          const md = await pdf.getMetadata();
          const inf = md?.info ?? {};
          if (!cancelled) setMeta({ title: inf.Title || undefined, author: inf.Author || undefined });
        } catch { /* metadata optional */ }
        if (!cancelled) setLoading(false);
      } catch (e: any) {
        if (cancelled) return;
        if (String(e?.name) === "PasswordException" || /password/i.test(String(e?.message))) {
          setError("This PDF is password-protected");
          setHint("Encrypted PDFs cannot be opened client-side without the password. PDF.js reports a PasswordException for this file.");
        } else {
          setError(String(e?.message ?? e));
          setHint("The PDF structure could not be parsed — the file may be truncated or corrupted. Check the hex view.");
        }
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      try { task?.destroy?.(); } catch { /* already destroyed */ }
    };
  }, [arrayBuffer, file]);

  /* ------------------------------ fit-width scale ------------------------------ */
  React.useEffect(() => {
    if (!baseDim || !bodyRef.current) return;
    const el = bodyRef.current;
    const compute = () => {
      const w = el.clientWidth - 48; // padding + scrollbar
      if (w > 50 && baseDim.w > 0) setFitScale(clamp(w / baseDim.w, 0.08, 6));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [baseDim]);

  /* ------------------------------ virtual page observer ------------------------------ */
  React.useEffect(() => {
    if (!numPages || !bodyRef.current) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page || 0);
          if (!n) continue;
          if (e.isIntersecting) ratios.set(n, e.intersectionRatio);
          else ratios.delete(n);
        }
        setVisiblePages(new Set(ratios.keys()));
        let best = 0;
        let bestR = -1;
        ratios.forEach((r, n) => { if (r > bestR) { bestR = r; best = n; } });
        if (best > 0) setPage(best);
      },
      { root: bodyRef.current, rootMargin: "600px 0px" },
    );
    ioRef.current = io;
    // register wrappers that already exist
    pageElsRef.current.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      ioRef.current = null;
    };
  }, [numPages, loading]);

  const registerPageEl = React.useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) {
      pageElsRef.current.set(n, el);
      ioRef.current?.observe(el);
    } else {
      const old = pageElsRef.current.get(n);
      if (old && ioRef.current) ioRef.current.unobserve(old);
      pageElsRef.current.delete(n);
    }
  }, []);

  /* ------------------------------ navigation ------------------------------ */
  const goToPage = React.useCallback((n: number) => {
    const clamped = clamp(n, 1, numPages || 1);
    const el = pageElsRef.current.get(clamped);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setPage(clamped);
  }, [numPages]);

  const jumpAndFlash = React.useCallback((n: number) => {
    goToPage(n);
    setFlashPage(n);
    setTimeout(() => setFlashPage((p) => (p === n ? null : p)), 1600);
  }, [goToPage]);

  /* ------------------------------ search ------------------------------ */
  const runSearch = React.useCallback(async () => {
    const q = query.trim();
    if (!q || !doc) return;
    setMatches(null);
    setSearchProgress(`searching page 1 / ${numPages}`);
    setActiveMatch(-1);
    const out: SearchMatch[] = [];
    const needle = q.toLowerCase();
    try {
      for (let i = 1; i <= numPages && out.length < MATCH_CAP; i++) {
        setSearchProgress(`searching page ${i} / ${numPages}`);
        // yield to the UI thread every few pages
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        const full = (tc.items as any[]).map((it) => it.str ?? "").join(" ");
        const lower = full.toLowerCase();
        let idx = lower.indexOf(needle);
        let found = 0;
        while (idx !== -1 && out.length < MATCH_CAP && found < 20) {
          const from = Math.max(0, idx - 42);
          const to = Math.min(full.length, idx + needle.length + 42);
          out.push({
            page: i,
            snippet: (from > 0 ? "…" : "") + full.slice(from, to).replace(/\s+/g, " ").trim() + (to < full.length ? "…" : ""),
          });
          found++;
          idx = lower.indexOf(needle, idx + needle.length);
        }
      }
      setMatches(out);
    } catch (e) {
      setMatches([]);
      setSearchProgress(null);
    }
    setSearchProgress(null);
  }, [query, doc, numPages]);

  /* ------------------------------ download ------------------------------ */
  const onDownload = React.useCallback(() => {
    downloadBlob(arrayBuffer ?? file, fileName || "document.pdf", "application/pdf");
  }, [arrayBuffer, file, fileName]);

  /* ------------------------------ render ------------------------------ */
  if (error) return <ErrorCard title={error} message={hint ?? undefined} hint={`File: ${fileName} · ${formatBytes(file.size)}`} />;

  const showLoading = loading || (!doc && !error);
  if (showLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">PDF</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label={streamed && loading ? "Large PDF — reading from file…" : "Loading PDF…"} />
      </div>
    );
  }

  const zoomPct = Math.round(scale * 100);
  const zoomIn = () => {
    const next = ZOOM_STEPS.find((z) => z > scale) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    setZoomMode(next);
  };
  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((z) => z < scale) ?? ZOOM_STEPS[0];
    setZoomMode(prev);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">PDF{streamed ? " · streamed" : ""}</Chip>
            <ToolbarDivider />
            <ToolButton label="Prev" disabled={page <= 1} onClick={() => goToPage(page - 1)} title="Previous page"><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
            <span className="min-w-16 text-center font-mono text-[11px] text-zinc-300">
              {page} <span className="text-zinc-600">/ {numPages}</span>
            </span>
            <ToolButton label="Next" disabled={page >= numPages} onClick={() => goToPage(page + 1)} title="Next page"><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
            <ToolbarDivider />
            <ToolButton label={`${zoomPct}%`} disabled={zoomPct >= 400} onClick={zoomIn} title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Out" disabled={zoomPct <= 25} onClick={zoomOut} title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton active={zoomMode === "fit"} label="Fit" onClick={() => setZoomMode("fit")} title="Fit width"><Maximize2 className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label={`${((rotation % 360) + 360) % 360}°`} onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate 90°"><RotateCw className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-[15rem] items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2 focus-within:border-emerald-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search text…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {matches && matches.length ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{matches.length}</span> : null}
            {query ? (
              <button type="button" onClick={() => { setQuery(""); setMatches(null); }} className="shrink-0 p-1 text-zinc-500 hover:text-zinc-200" title="Clear">
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        }
        right={
          <>
            <ToolButton active={showThumbs} label="Pages" onClick={() => setShowThumbs((s) => !s)} title="Page thumbnails"><PanelLeft className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Save" onClick={onDownload} title="Download PDF"><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />

      {searchProgress ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-[11px] text-zinc-400">
          <FileText className="h-3.5 w-3.5 animate-pulse text-emerald-400" />
          {searchProgress}
        </div>
      ) : null}

      {matches ? (
        <div className="max-h-52 shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-900/70 scrollbar-thin">
          {searchProgress ? (
            <div className="px-3 py-2 text-[11px] text-zinc-500">{searchProgress}</div>
          ) : matches.length ? (
            <div className="divide-y divide-zinc-800/60">
              {matches.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setActiveMatch(i); jumpAndFlash(m.page); }}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs hover:bg-zinc-800/60",
                    activeMatch === i && "bg-emerald-900/20",
                  )}
                >
                  <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[10px] text-zinc-400">p{m.page}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{m.snippet}</span>
                </button>
              ))}
              {matches.length >= MATCH_CAP ? <div className="px-3 py-1.5 text-[10px] text-zinc-600">showing first {MATCH_CAP} matches</div> : null}
            </div>
          ) : (
            <div className="px-3 py-2 text-[11px] text-zinc-500">No text matches found{query ? ` for “${query.trim()}”` : ""} (scanned or image-only PDFs have no text layer).</div>
          )}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {showThumbs ? (
          <nav className="hidden w-40 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/70 p-2 scrollbar-thin md:block" aria-label="Page thumbnails">
            {Array.from({ length: Math.min(numPages, THUMB_CAP) }, (_, i) => i + 1).map((n) => (
              <Thumb key={n} doc={doc} pageNum={n} current={n === page} onClick={() => jumpAndFlash(n)} />
            ))}
            {numPages > THUMB_CAP ? (
              <div className="px-2 py-2 text-[10px] text-zinc-600">… {numPages - THUMB_CAP} more pages (use page nav)</div>
            ) : null}
          </nav>
        ) : null}

        <ViewerBody scrollRef={bodyRef} className="bg-zinc-950">
          <div className="mx-auto w-fit px-4 py-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <PageView
                key={n}
                doc={doc}
                pageNum={n}
                scale={scale}
                rotation={rotation}
                visible={visiblePages.has(n)}
                dims={pageDims[n] ?? baseDim ?? { w: 612, h: 792 }}
                onDims={(d) => setPageDims((m) => (m[n] ? m : { ...m, [n]: d }))}
                registerEl={registerPageEl}
                flash={flashPage === n}
              />
            ))}
          </div>
        </ViewerBody>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {meta.title ? <span className="text-zinc-300">{meta.title}</span> : fileName}
          {meta.author ? <span className="text-zinc-600"> · {meta.author}</span> : null}
        </span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          {numPages} page{numPages === 1 ? "" : "s"} · {formatBytes(file.size)} · {detected.name}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------ single page ------------------------------ */

function PageView({
  doc, pageNum, scale, rotation, visible, dims, onDims, registerEl, flash,
}: {
  doc: any;
  pageNum: number;
  scale: number;
  rotation: number;
  visible: boolean;
  dims: { w: number; h: number };
  onDims: (d: { w: number; h: number }) => void;
  registerEl: (n: number, el: HTMLDivElement | null) => void;
  flash: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const taskRef = React.useRef<any>(null);
  const renderedKeyRef = React.useRef("");
  const [status, setStatus] = React.useState<"idle" | "done" | "error">("idle");

  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const w = Math.max(40, Math.round((swap ? dims.h : dims.w) * scale));
  const h = Math.max(40, Math.round((swap ? dims.w : dims.h) * scale));

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc) return;
    const key = `${scale.toFixed(3)}|${rot}`;
    if (!visible) {
      // release the bitmap when far off-screen (re-rendered on revisit)
      if (canvas && renderedKeyRef.current && renderedKeyRef.current !== "cleared") {
        canvas.width = 0;
        canvas.height = 0;
        renderedKeyRef.current = "cleared";
        setStatus("idle");
      }
      return;
    }
    if (renderedKeyRef.current === key && status === "done") return;
    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(pageNum);
        if (cancelled) return;
        const vp = pdfPage.getViewport({ scale, rotation: rot });
        onDims({ w: vp.width / scale || dims.w, h: vp.height / scale || dims.h });
        const c = canvasRef.current;
        if (!c || cancelled) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        c.width = Math.max(1, Math.floor(vp.width * dpr));
        c.height = Math.max(1, Math.floor(vp.height * dpr));
        c.style.width = `${Math.floor(vp.width)}px`;
        c.style.height = `${Math.floor(vp.height)}px`;
        const ctx = c.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        try {
          taskRef.current?.cancel?.();
        } catch { /* ignore */ }
        const task = pdfPage.render({
          canvasContext: ctx,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        taskRef.current = task;
        await task.promise;
        if (cancelled) return;
        renderedKeyRef.current = key;
        setStatus("done");
      } catch (e: any) {
        if (cancelled || String(e?.name) === "RenderingCancelledException") return;
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      try { taskRef.current?.cancel?.(); } catch { /* ignore */ }
    };
  }, [visible, scale, rot, doc, pageNum]);

  return (
    <div
      ref={(el) => registerEl(pageNum, el)}
      data-page={pageNum}
      className={cn(
        "relative mx-auto mb-4 overflow-hidden rounded-md border shadow-lg shadow-black/40 transition-colors",
        flash ? "border-amber-500" : "border-zinc-800",
        status === "error" ? "border-rose-900/60" : "bg-white",
      )}
      style={{ width: w, height: h }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {status !== "done" ? (
        <div className={cn("absolute inset-0 flex flex-col items-center justify-center gap-2", status === "error" ? "bg-zinc-950" : "bg-zinc-200/95")}>
          {status === "error" ? (
            <>
              <AlertTriangle className="h-6 w-6 text-rose-400" />
              <span className="text-[11px] text-rose-300">Page {pageNum} failed to render</span>
            </>
          ) : (
            <>
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-zinc-700" />
              <span className="text-[11px] text-zinc-500">page {pageNum}</span>
            </>
          )}
        </div>
      ) : null}
      <span className="absolute bottom-1 right-1 rounded bg-zinc-950/70 px-1 font-mono text-[9px] text-zinc-400">{pageNum}</span>
    </div>
  );
}

/* ------------------------------ thumbnail ------------------------------ */

function Thumb({ doc, pageNum, current, onClick }: { doc: any; pageNum: number; current: boolean; onClick: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const boxRef = React.useRef<HTMLButtonElement | null>(null);
  const [state, setState] = React.useState<"idle" | "done" | "error">("idle");

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || state === "done") return;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      try {
        const pdfPage = await doc.getPage(pageNum);
        const vp1 = pdfPage.getViewport({ scale: 1 });
        const s = 128 / vp1.width;
        const vp = pdfPage.getViewport({ scale: s });
        const c = canvasRef.current;
        if (!c) return;
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        c.style.width = "100%";
        const ctx = c.getContext("2d");
        if (!ctx) return;
        await pdfPage.render({ canvasContext: ctx, viewport: vp }).promise;
        setState("done");
      } catch {
        setState("error");
      }
    }, { root: (el.offsetParent as HTMLElement | null) ?? null, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [doc, pageNum, state]);

  return (
    <button
      type="button"
      ref={boxRef}
      onClick={onClick}
      className={cn(
        "mb-2 block w-full overflow-hidden rounded border bg-white transition-colors",
        current ? "border-emerald-500 ring-1 ring-emerald-600/50" : "border-zinc-800 hover:border-zinc-600",
      )}
      title={`Page ${pageNum}`}
    >
      <canvas ref={canvasRef} className="block aspect-[1/1.414] w-full object-contain" />
      <span className={cn("block bg-zinc-900 py-0.5 text-center font-mono text-[9px]", current ? "text-emerald-300" : "text-zinc-500")}>{pageNum}</span>
    </button>
  );
}
