"use client";

import * as React from "react";
import type { FileTab, ViewerId } from "@/lib/types";
import { detectFromHead } from "@/lib/detect";
import { VIEWER_REGISTRY, VIEWER_LABELS } from "@/components/viewers/registry";
import { Landing, LogoMark } from "./landing";
import { FormatExplorer } from "./format-explorer";
import { InfoPanel } from "./info-panel";
import { DiffView } from "./diff-view";
import { SplitJoinView } from "./split-join-view";
import { RecentFilesRow } from "./recent-panel";
import { ShortcutsHelp } from "./shortcuts-help";
import { AccentPicker } from "./accent-picker";
import { analyzeSegments } from "@/lib/splitjoin";
import { addRecentFile } from "@/lib/recent-files";
import { FORMAT_STATS } from "@/lib/formats/stats";
import { buildBatchReportHtml, type ForensicInput } from "@/lib/forensic-report";
import { shannonEntropy, crc32, sha1, sha256, md5, toHex, ENCODINGS, cn, formatBytes } from "@/lib/utils";
import {
  UploadCloud, X, ChevronDown, PanelLeft, FileSearch, ShieldCheck, Github, Keyboard,
  GitCompare, Combine, Layers, FolderDown, FileText, Loader2,
} from "lucide-react";

const HEAD_BYTES = 65536;
const FULL_CAP = 96 * 1024 * 1024;
const MEDIA_VIEWERS = new Set(["image", "video", "audio", "svg", "pdf", "epub"]);
/** max files opened from a single recursive folder drop */
const FOLDER_FILE_CAP = 24;
/** hashing cap for batch reports (matches the info panel) */
const BATCH_HASH_LIMIT = 50 * 1024 * 1024;
const BATCH_FILE_CAP = 12;

/* per-category accent dot shown in tab chips (matches landing family hues) */
const CAT_DOT: Record<string, string> = {
  image: "bg-emerald-500", video: "bg-rose-500", audio: "bg-amber-500", document: "bg-teal-400",
  spreadsheet: "bg-lime-500", presentation: "bg-orange-500", ebook: "bg-violet-500", archive: "bg-yellow-400",
  code: "bg-emerald-400", text: "bg-zinc-400", data: "bg-fuchsia-500", font: "bg-pink-500",
  "3d": "bg-teal-300", database: "bg-cyan-400", email: "bg-orange-300", geo: "bg-green-500",
  scientific: "bg-purple-400", game: "bg-fuchsia-400", system: "bg-zinc-200", disk: "bg-stone-400",
  config: "bg-amber-300", subtitle: "bg-sky-300", binary: "bg-zinc-500", other: "bg-zinc-400",
};

type AppMode = "viewer" | "diff";

let tabSeq = 0;

export function OmniscopeApp() {
  const [tabs, setTabs] = React.useState<FileTab[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = React.useState(false);
  const [explorerCat, setExplorerCat] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [viewerMenu, setViewerMenu] = React.useState(false);
  const [mode, setMode] = React.useState<AppMode>("viewer");
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [accentOpen, setAccentOpen] = React.useState(false);
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [joinSeed, setJoinSeed] = React.useState<File[]>([]);
  const [segmentHint, setSegmentHint] = React.useState<{ files: File[]; base: string; pattern: string } | null>(null);
  const [flashTabId, setFlashTabId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const buffersRef = React.useRef(new Map<string, ArrayBuffer>());
  const headsRef = React.useRef(new Map<string, Uint8Array>());

  const totalIdentities = React.useMemo(() => FORMAT_STATS.identities, []);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  /* ---------------- file pipeline ---------------- */

  const addFiles = React.useCallback(async (files: File[]) => {
    for (const file of files.slice(0, 24)) {
      const id = `f${++tabSeq}-${Date.now()}`;
      const tab: FileTab = {
        id, file, name: file.name || "untitled", size: file.size,
        detected: null, status: "detecting", viewerOverride: null,
      };
      setTabs((ts) => [...ts, tab]);
      setActiveId(id);
      try {
        const headBuf = await file.slice(0, HEAD_BYTES).arrayBuffer();
        const head = new Uint8Array(headBuf);
        headsRef.current.set(id, head);
        const detected = detectFromHead(tab.name, head);
        let objectUrl: string | undefined;
        if (MEDIA_VIEWERS.has(detected.viewer)) {
          objectUrl = URL.createObjectURL(file);
        }
        if (file.size <= FULL_CAP) {
          const full = file.size <= head.length ? headBuf : await file.arrayBuffer();
          buffersRef.current.set(id, full);
        }
        setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, detected, status: "ready", objectUrl } : t)));
        void addRecentFile(file, { name: detected.name, viewer: detected.viewer });
      } catch (e) {
        setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, status: "error" } : t)));
        console.error("detect failed", e);
      }
    }
    // segment auto-detection: when 2+ of the dropped files form a split set, offer to join
    try {
      const opened = files.slice(0, 24);
      const mergedSet = analyzeSegments(opened);
      if (mergedSet && mergedSet.files.length >= 2) {
        setSegmentHint({ files: mergedSet.files, base: mergedSet.base, pattern: mergedSet.pattern });
      }
    } catch { /* ignore */ }
  }, []);

  const openJoinView = React.useCallback((seed: File[]) => {
    setJoinSeed(seed);
    setJoinOpen(true);
    setSegmentHint(null);
  }, []);

  /* ---------------- batch forensic report ---------------- */

  /** stable tab list for the info panel's cross-tab sum-file verification */
  const infoTabs = React.useMemo(() => tabs.slice(0, BATCH_FILE_CAP), [tabs]);

  /** activate a tab, scroll its chip into view and flash it (sum-file verdict jump) */
  const jumpToTab = React.useCallback((tabId: string) => {
    setActiveId(tabId);
    setFlashTabId(tabId);
    window.setTimeout(() => setFlashTabId((cur) => (cur === tabId ? null : cur)), 1400);
    requestAnimationFrame(() => {
      stripRef.current
        ?.querySelector(`[data-tab-id="${CSS.escape(tabId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  }, []);

  /** Hash + analyze every open tab (cap BATCH_FILE_CAP) and download one HTML report */
  const downloadBatchReport = React.useCallback(async () => {
    const subjects = tabs.slice(0, BATCH_FILE_CAP).filter((t) => t.status === "ready" || t.detected);
    if (!subjects.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const inputs: ForensicInput[] = [];
      for (const t of subjects) {
        const head = new Uint8Array(await t.file.slice(0, 262144).arrayBuffer());
        const bytes = t.size <= BATCH_HASH_LIMIT ? new Uint8Array(await t.file.arrayBuffer()) : head;
        const [s1, s256] = await Promise.all([sha1(bytes), sha256(bytes)]);
        const d = t.detected;
        inputs.push({
          fileName: t.name,
          size: t.size,
          lastModified: t.file.lastModified,
          mime: t.file.type || "(none declared)",
          formatName: d?.name,
          category: d?.cat,
          method: d?.method,
          ext: d?.ext,
          magicHex: d?.magicHex,
          viewerLabel: d ? (VIEWER_LABELS[d.viewer] ?? d.viewer) : undefined,
          entropy: shannonEntropy(head),
          headHex: toHex(head.subarray(0, 16)),
          hashes: {
            crc32: crc32(bytes).toString(16).padStart(8, "0"),
            md5: md5(bytes),
            sha1: s1,
            sha256: s256,
          },
          hashPartial: t.size > BATCH_HASH_LIMIT,
          hashLimitBytes: BATCH_HASH_LIMIT,
          tool: "OMNISCOPE",
          identities: FORMAT_STATS.identities,
        });
      }
      const html = buildBatchReportHtml(inputs);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `omniscope-batch-report-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setBatchBusy(false);
    }
  }, [tabs, batchBusy]);

  /* ---------------- folder (directory) drop ---------------- */

  const [folderNote, setFolderNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!folderNote) return;
    const t = window.setTimeout(() => setFolderNote(null), 9000);
    return () => window.clearTimeout(t);
  }, [folderNote]);

  const closeTab = React.useCallback((id: string) => {
    setTabs((ts) => {
      const t = ts.find((x) => x.id === id);
      if (t?.objectUrl) URL.revokeObjectURL(t.objectUrl);
      const next = ts.filter((x) => x.id !== id);
      setActiveId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
      return next;
    });
    buffersRef.current.delete(id);
    headsRef.current.delete(id);
  }, []);

  /* ---------------- global drop & paste ---------------- */

  React.useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      /*
       * Directory drop: DataTransferItem.webkitGetAsEntry() must be called
       * synchronously (the item list is dead after the first await), then the
       * traversal runs on the entry objects which stay valid.
       */
      const items = e.dataTransfer?.items;
      const entries: FileSystemEntry[] = [];
      if (items?.length) {
        for (const it of Array.from(items)) {
          const en = it.webkitGetAsEntry?.();
          if (en) entries.push(en);
        }
      }
      if (entries.some((en) => en.isDirectory)) {
        const out: File[] = [];
        const walk = async (entry: FileSystemEntry, depth: number): Promise<void> => {
          if (out.length >= FOLDER_FILE_CAP || depth > 8) return;
          if (entry.isFile) {
            const f = await new Promise<File | null>((resolve) =>
              (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
            if (f) out.push(f);
          } else if (entry.isDirectory) {
            const reader = (entry as FileSystemDirectoryEntry).createReader();
            for (;;) {
              const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
                reader.readEntries(resolve, reject)).catch(() => [] as FileSystemEntry[]);
              if (!batch.length) break;
              for (const child of batch) {
                if (out.length >= FOLDER_FILE_CAP) break;
                await walk(child, depth + 1);
              }
              if (out.length >= FOLDER_FILE_CAP) break;
            }
          }
        };
        (async () => {
          for (const en of entries) await walk(en, 0);
          if (out.length) {
            setFolderNote(
              `Folder drop — opened ${Math.min(out.length, FOLDER_FILE_CAP)} file${out.length === 1 ? "" : "s"} ` +
              `from “${entries.find((en) => en.isDirectory)?.name ?? "folder"}” (cap ${FOLDER_FILE_CAP} per drop).`,
            );
            void addFiles(out.slice(0, FOLDER_FILE_CAP));
          }
        })();
        return;
      }
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) addFiles(files);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) addFiles(files);
    };
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("paste", onPaste);
    };
  }, [addFiles]);

  /* ---------------- keyboard ---------------- */

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        inputRef.current?.click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setExplorerCat(null);
        setExplorerOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setMode((m) => (m === "diff" ? "viewer" : "diff"));
      }
      if ((e.key === "?" || e.key.toLowerCase() === "a") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase() ?? "";
        const typing = tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable;
        if (!typing) {
          e.preventDefault();
          if (e.key === "?") setHelpOpen((v) => !v);
          else setAccentOpen((v) => !v);
        }
      }
      if (e.key === "Escape") {
        if (helpOpen) { setHelpOpen(false); return; }
        if (accentOpen) { setAccentOpen(false); return; }
        if (explorerOpen) { setExplorerOpen(false); return; }
        if (joinOpen) { setJoinOpen(false); return; }
        if (mode === "diff") { setMode("viewer"); return; }
        if (activeId) closeTab(activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accentOpen, activeId, closeTab, explorerOpen, helpOpen, joinOpen, mode]);

  /* ---------------- render ---------------- */

  const effectiveViewer: ViewerId = (activeTab?.viewerOverride ?? activeTab?.detected?.viewer ?? "fallback") as ViewerId;
  const Viewer = VIEWER_REGISTRY[effectiveViewer] ?? VIEWER_REGISTRY.fallback;

  return (
    <div
      className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 antialiased"
      style={{ backgroundColor: "#09090b" }}
    >
      {/* signature top hairline */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" aria-hidden />

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) addFiles(files);
          e.target.value = "";
        }}
      />

      {/* header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <button type="button" onClick={() => { setActiveId(null); }} className="flex items-center gap-2.5" aria-label="Home">
            <LogoMark />
            <span className="hidden flex-col items-start leading-none sm:flex">
              <span className="text-sm font-bold tracking-tight text-zinc-100">OMNISCOPE</span>
              <span className="text-[9px] uppercase tracking-[0.2em] text-zinc-600">universal file lab</span>
            </span>
          </button>

          <div className="ml-2 hidden items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 md:flex">
            <span className="font-mono text-[11px] tabular-nums text-emerald-300">{totalIdentities.toLocaleString()}</span>
            <span className="text-[10px] text-zinc-500">formats</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode((m) => (m === "diff" ? "viewer" : "diff"))}
              title="Compare two files byte-by-byte"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                mode === "diff"
                  ? "border-rose-800/70 bg-rose-950/40 text-rose-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-rose-800 hover:text-rose-300",
              )}
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Compare</span>
            </button>
            <button
              type="button"
              onClick={() => openJoinView(tabs.map((t) => t.file))}
              title="Join split files (.001, .r00, .partN…"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-700 hover:text-amber-300"
            >
              <Combine className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Join</span>
            </button>
            <button
              type="button"
              onClick={() => { setExplorerCat(null); setExplorerOpen(true); }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-700 hover:text-emerald-300"
              title="Ctrl+K"
            >
              <FileSearch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Explore</span>
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500"
              title="Ctrl+O"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open file</span>
            </button>
            {tabs.length > 0 ? (
              <button
                type="button"
                onClick={() => setSidebarOpen((v) => !v)}
                className="hidden h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100 lg:inline-flex"
                title="Toggle info panel"
                aria-label="Toggle info panel"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            ) : null}
            {tabs.length >= 2 ? (
              <button
                type="button"
                onClick={() => void downloadBatchReport()}
                disabled={batchBusy}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-emerald-700 hover:text-emerald-300",
                  batchBusy && "cursor-wait opacity-60",
                )}
                title={`Batch forensic report — hash and document all ${Math.min(tabs.length, BATCH_FILE_CAP)} open files (one printable HTML)`}
                aria-label="Batch forensic report"
              >
                {batchBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              </button>
            ) : null}
            <AccentPicker open={accentOpen} onOpenChange={setAccentOpen} />
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* tab strip */}
        {tabs.length > 0 ? (
          <div ref={stripRef} className="flex h-9 items-center gap-1 overflow-x-auto border-t border-zinc-800/60 px-2 scrollbar-thin">
            {tabs.map((t) => (
              <div
                key={t.id}
                data-tab-id={t.id}
                className={cn(
                  "group flex h-7 max-w-52 shrink-0 items-center gap-2 rounded-md border px-2.5 text-xs transition-[colors,box-shadow] duration-150",
                  t.id === activeId
                    ? "om-tab-active border-emerald-800/60 bg-gradient-to-b from-emerald-950/50 to-emerald-950/20 text-emerald-200"
                    : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                  t.id === flashTabId && "om-tab-flash",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full transition-colors",
                    t.status !== "ready"
                      ? "animate-pulse bg-zinc-600"
                      : CAT_DOT[t.detected?.cat ?? "other"] ?? "bg-zinc-400",
                  )}
                  title={t.detected?.cat ?? "detecting"}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setActiveId(t.id)}
                  className="max-w-40 truncate font-mono text-[11px]"
                  title={t.detected ? `${t.name}\n${t.detected.name} · ${t.detected.cat}` : t.name}
                >
                  {t.name}
                </button>
                <span className="shrink-0 font-mono text-[9px] text-zinc-600">{formatBytes(t.size, 0)}</span>
                <button
                  type="button"
                  onClick={() => closeTab(t.id)}
                  className="shrink-0 rounded-sm p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Close ${t.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-700 text-zinc-500 transition-colors hover:border-emerald-700 hover:text-emerald-300"
              title="Open another file (Ctrl+O)"
              aria-label="Open another file"
            >
              <UploadCloud className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </header>

      {/* body */}
      {(tabs.length === 0 || !activeTab) && mode !== "diff" ? (
        <Landing
          onFiles={addFiles}
          onExplore={(cat) => { setExplorerCat(cat ?? null); setExplorerOpen(true); }}
          totalIdentities={totalIdentities}
          recent={<RecentFilesRow onOpenFile={(f) => addFiles([f])} />}
        />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col lg:h-[calc(100vh-5rem)]">
          {/* viewer header */}
          {mode === "diff" ? (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-rose-900/40 bg-rose-950/20 px-3">
              <GitCompare className="h-3.5 w-3.5 text-rose-400" />
              <span className="text-xs font-semibold text-rose-200">Compare</span>
              <span className="hidden text-[10px] text-rose-300/60 sm:inline">byte &amp; text diff · hashes · patches</span>
              <button
                type="button"
                onClick={() => setMode("viewer")}
                className="ml-auto rounded-md border border-rose-900/60 bg-zinc-900 px-2.5 py-1 text-[10px] font-medium text-rose-300 hover:border-rose-600"
              >
                Back to viewer
              </button>
            </div>
          ) : activeTab ? (
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-3">
              <span className="truncate font-mono text-xs text-zinc-300">{activeTab.name}</span>
              {activeTab.detected ? (
                <span className={cn(
                  "hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] sm:inline-flex",
                  activeTab.detected.method === "magic" || activeTab.detected.method === "container"
                    ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
                    : "border-teal-900/60 bg-teal-950/40 text-teal-300",
                )}>
                  {activeTab.detected.name}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="hidden font-mono text-[10px] text-zinc-600 md:inline">{formatBytes(activeTab.size)}</span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setViewerMenu((v) => !v)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-300 hover:border-emerald-700 hover:text-emerald-300"
                  >
                    {VIEWER_LABELS[effectiveViewer] ?? effectiveViewer} viewer
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {viewerMenu ? (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setViewerMenu(false)} />
                      <div className="absolute right-0 top-9 z-50 max-h-96 w-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl shadow-black/50 scrollbar-thin">
                        {Object.entries(VIEWER_LABELS).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            onClick={() => {
                              setTabs((ts) => ts.map((t) => (t.id === activeTab.id ? { ...t, viewerOverride: id as ViewerId } : t)));
                              setViewerMenu(false);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800",
                              id === effectiveViewer && "text-emerald-300",
                            )}
                          >
                            {label}
                            {id === (activeTab.detected?.viewer ?? "fallback") ? (
                              <span className="ml-auto text-[9px] text-zinc-600">auto</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* segment join hint banner */}
          {mode !== "diff" && segmentHint ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-900/40 bg-amber-950/20 px-3 py-1.5 text-xs">
              <Layers className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span className="text-amber-200">
                <span className="font-mono">{segmentHint.base}</span> — {segmentHint.files.length} split segments detected ({segmentHint.pattern})
              </span>
              <button
                type="button"
                onClick={() => openJoinView(segmentHint.files)}
                className="ml-auto rounded-md border border-amber-700/60 bg-amber-900/30 px-2.5 py-1 text-[10px] font-semibold text-amber-200 hover:border-amber-500"
              >
                Join them
              </button>
              <button
                type="button"
                onClick={() => setSegmentHint(null)}
                className="rounded-sm p-1 text-amber-300/60 hover:text-amber-200"
                aria-label="Dismiss join suggestion"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          {/* folder drop note banner */}
          {mode !== "diff" && folderNote ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-teal-900/40 bg-teal-950/20 px-3 py-1.5 text-xs">
              <FolderDown className="h-3.5 w-3.5 shrink-0 text-teal-400" />
              <span className="text-teal-200">{folderNote}</span>
              <button
                type="button"
                onClick={() => setFolderNote(null)}
                className="ml-auto rounded-sm p-1 text-teal-300/60 hover:text-teal-200"
                aria-label="Dismiss folder note"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            {/* viewer / diff */}
            <div className="min-w-0 flex-1 bg-zinc-950">
              {mode === "diff" ? (
                <div className="h-full min-h-[70vh] lg:min-h-0">
                  <DiffView
                    initialA={activeTab?.file ?? null}
                    initialB={tabs.find((t) => t.id !== activeId && t.id !== activeTab?.id)?.file ?? null}
                    onClose={() => setMode("viewer")}
                  />
                </div>
              ) : activeTab && activeTab.status !== "detecting" ? (
                <div className="h-full min-h-[70vh] lg:min-h-0">
                  <Viewer
                    file={activeTab.file}
                    arrayBuffer={buffersRef.current.get(activeTab.id) ?? null}
                    head={headsRef.current.get(activeTab.id) ?? new Uint8Array()}
                    detected={activeTab.detected ?? { record: null, name: "Unknown", cat: "binary", viewer: "hex", mime: "application/octet-stream", method: "unknown" }}
                    fileName={activeTab.name}
                    onOpenFile={(f) => addFiles([f])}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  Reading &amp; identifying…
                </div>
              )}
            </div>
            {/* sidebar */}
            {activeTab && sidebarOpen ? (
              <aside className="hidden w-72 shrink-0 border-l border-zinc-800/80 bg-zinc-950/60 lg:block">
                <InfoPanel tab={activeTab} openTabs={infoTabs} onClose={() => closeTab(activeTab.id)} onJumpToTab={jumpToTab} />
              </aside>
            ) : null}
          </div>
        </main>
      )}

      {/* footer */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/95 px-4 py-2.5">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            100% client-side — bytes never leave your browser
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-zinc-400 transition-colors hover:border-emerald-800 hover:text-emerald-300"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-3 w-3" />
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1 font-mono">?</kbd>
            all shortcuts
          </button>
          <span className="hidden items-center gap-1.5 md:inline-flex text-zinc-600">
            <span className="h-1 w-1 rounded-full bg-emerald-500/50" aria-hidden />
            compare · 3-way merge · join · recents · folders · bulk extract · verify checksums · converters · forensic &amp; batch reports · 9 accent themes
          </span>
          <span className="ml-auto hidden items-center gap-1.5 sm:inline-flex">
            <Github className="h-3.5 w-3.5" />
            HTML · CSS · JavaScript only — deploys to GitHub Pages
          </span>
        </div>
      </footer>

      {/* drag overlay */}
      {dragOver ? (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-950/20 px-12 py-10 text-center">
            <UploadCloud className="mx-auto mb-3 h-14 w-14 animate-bounce text-emerald-400" />
            <div className="text-lg font-semibold text-emerald-200">Drop to open</div>
            <div className="mt-1 text-xs text-emerald-300/60">multiple files welcome</div>
          </div>
        </div>
      ) : null}

      <FormatExplorer open={explorerOpen} onOpenChange={setExplorerOpen} initialCat={explorerCat} />

      {/* keyboard shortcuts sheet */}
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* split-file joiner overlay */}
      {joinOpen ? (
        <SplitJoinView
          initialFiles={joinSeed}
          onOpenMerged={(f) => { setJoinOpen(false); void addFiles([f]); }}
          onClose={() => setJoinOpen(false)}
        />
      ) : null}
    </div>
  );
}
