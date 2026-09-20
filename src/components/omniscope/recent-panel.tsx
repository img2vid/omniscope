"use client";

/**
 * OMNISCOPE — "RECENT FILES" row for the landing page (Task 4-c).
 *
 * Horizontal row of recent-file chips backed by @/lib/recent-files (IndexedDB).
 * Blobs are fetched lazily — only on click — via getRecentFile(). Renders
 * nothing when the recents list is empty or IndexedDB is unavailable, so the
 * landing stays clean. Hydration-safe: recents render only after mount.
 */

import * as React from "react";
import {
  History,
  X,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import {
  clearRecentFiles,
  formatRecentWhen,
  getRecentFile,
  listRecentFiles,
  removeRecentFile,
  type RecentEntry,
} from "@/lib/recent-files";

const MAX_VISIBLE = 50;
const HINT_MS = 2500;

type IconComponent = React.ComponentType<{ className?: string }>;

const IMAGE_VIEWERS = new Set(["image", "svg", "ico"]);
const AUDIO_VIEWERS = new Set(["audio", "midi"]);
const CODE_VIEWERS = new Set(["code", "xml", "wasm", "exe"]);
const TEXT_VIEWERS = new Set([
  "text", "markdown", "nfo", "csv", "pdf", "docx", "xlsx", "pptx", "odf",
  "epub", "mobi", "rtf", "subtitle", "eml", "ical", "vcf", "dbf", "hex",
]);

/** recents filter families (kept broad — chips only appear when mixed) */
const FAMILY_MEDIA = new Set(["image", "svg", "ico", "video", "audio", "midi"]);
const FAMILY_DOCS = new Set([
  "text", "markdown", "nfo", "pdf", "docx", "xlsx", "pptx", "odf",
  "epub", "mobi", "rtf", "subtitle", "eml", "ical", "vcf", "dbf", "csv",
]);
const FAMILY_CODE = new Set(["code", "xml", "wasm", "exe", "hex"]);
const FAMILY_DATA = new Set(["json", "sqlite", "torrent", "nbt", "chess", "gcode", "map", "dicom", "three3d", "font"]);

function familyOf(viewerId?: string): string {
  if (!viewerId) return "other";
  if (FAMILY_MEDIA.has(viewerId)) return "media";
  if (FAMILY_DOCS.has(viewerId)) return "docs";
  if (FAMILY_CODE.has(viewerId)) return "code";
  if (FAMILY_DATA.has(viewerId)) return "data";
  if (viewerId === "archive") return "archive";
  return "other";
}

const FAMILY_LABELS: Record<string, string> = {
  media: "media", docs: "docs", code: "code", data: "data", archive: "archives", other: "other",
};
const FAMILY_DOTS: Record<string, string> = {
  media: "bg-rose-400", docs: "bg-teal-300", code: "bg-emerald-300", data: "bg-fuchsia-400",
  archive: "bg-yellow-300", other: "bg-zinc-400",
};

/** viewerId → lucide file icon (verified exports; FileIcon is the fallback). */
function iconFor(viewerId?: string): IconComponent {
  if (!viewerId) return FileIcon;
  if (IMAGE_VIEWERS.has(viewerId)) return FileImage;
  if (viewerId === "video") return FileVideo;
  if (AUDIO_VIEWERS.has(viewerId)) return FileAudio;
  if (viewerId === "archive") return FileArchive;
  if (viewerId === "json") return FileJson;
  if (CODE_VIEWERS.has(viewerId)) return FileCode2;
  if (TEXT_VIEWERS.has(viewerId)) return FileText;
  return FileIcon;
}

/** detected-format color dot (emerald/teal/amber/rose palette — no blue/indigo). */
const DOT_COLORS: Record<string, string> = {
  image: "bg-emerald-400",
  svg: "bg-emerald-400",
  ico: "bg-emerald-400",
  video: "bg-rose-400",
  audio: "bg-amber-400",
  midi: "bg-amber-400",
  archive: "bg-yellow-300",
  json: "bg-teal-300",
  code: "bg-teal-300",
  xml: "bg-teal-300",
  wasm: "bg-teal-300",
  exe: "bg-rose-300",
  font: "bg-pink-400",
  three3d: "bg-teal-300",
  map: "bg-emerald-300",
  gcode: "bg-orange-300",
  chess: "bg-fuchsia-400",
  sqlite: "bg-teal-300",
  dicom: "bg-fuchsia-300",
  nbt: "bg-emerald-300",
  torrent: "bg-emerald-300",
  text: "bg-zinc-400",
  markdown: "bg-zinc-400",
  nfo: "bg-zinc-400",
  hex: "bg-zinc-500",
  pdf: "bg-rose-300",
  docx: "bg-teal-300",
  xlsx: "bg-lime-300",
  pptx: "bg-orange-300",
  odf: "bg-teal-300",
  epub: "bg-violet-400",
  mobi: "bg-violet-400",
  rtf: "bg-teal-300",
  csv: "bg-lime-300",
  subtitle: "bg-amber-300",
  eml: "bg-orange-300",
  ical: "bg-orange-300",
  vcf: "bg-orange-300",
  dbf: "bg-lime-300",
};

function dotFor(viewerId?: string): string {
  return (viewerId ? DOT_COLORS[viewerId] : undefined) ?? "bg-zinc-500";
}

export function RecentFilesRow({ onOpenFile }: { onOpenFile: (file: File) => void }): React.JSX.Element | null {
  const [entries, setEntries] = React.useState<RecentEntry[] | null>(null); // null = loading
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [hint, setHint] = React.useState<RecentEntry | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [family, setFamily] = React.useState<string | null>(null);
  const hintTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recents after mount (never during SSR/prerender).
  React.useEffect(() => {
    let alive = true;
    listRecentFiles(MAX_VISIBLE)
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Clear the transient hint timer on unmount.
  React.useEffect(() => {
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  const showHint = React.useCallback((entry: RecentEntry) => {
    setHint(entry);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  // Lazy: the blob is only fetched from IndexedDB at click time.
  const openEntry = React.useCallback(
    async (entry: RecentEntry) => {
      if (busyId) return;
      setBusyId(entry.id);
      const res = await getRecentFile(entry.id).catch(() => null);
      if (res && res.blob) {
        setHint(null);
        onOpenFile(new File([res.blob], entry.name, { type: entry.mime }));
      } else {
        showHint(entry);
      }
      setBusyId(null);
    },
    [busyId, onOpenFile, showHint],
  );

  const removeEntry = React.useCallback((id: string) => {
    setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    setHint((h) => (h && h.id === id ? null : h));
    void removeRecentFile(id);
  }, []);

  const clearAll = React.useCallback(() => {
    setConfirmClear(false);
    setHint(null);
    setEntries([]);
    setFamily(null);
    void clearRecentFiles();
  }, []);

  /* families present (for the filter pills — only shown when the list is mixed) */
  const familyCounts = React.useMemo(() => {
    if (!entries) return null;
    const m = new Map<string, number>();
    for (const e of entries) {
      const f = familyOf(e.viewerId);
      m.set(f, (m.get(f) ?? 0) + 1);
    }
    return m;
  }, [entries]);

  const filtered = React.useMemo(
    () => (entries && family ? entries.filter((e) => familyOf(e.viewerId) === family) : entries ?? []),
    [entries, family],
  );

  /* ---------------- loading: skeleton shimmer, no stale SSR markup ---------------- */
  if (entries === null) {
    return (
      <section className="mb-8" aria-busy="true" aria-label="Recent files">
        <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          <History className="h-3.5 w-3.5" aria-hidden /> recent files
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-9 w-40 animate-pulse rounded-full bg-zinc-800/60" aria-hidden />
          ))}
        </div>
      </section>
    );
  }

  /* ---------------- empty / IndexedDB unavailable → render nothing ---------------- */
  if (entries.length === 0) return null;

  /* ---------------- chips row ---------------- */
  return (
    <section className="mb-8" aria-label="Recently opened files">
      <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        <History className="h-3.5 w-3.5" aria-hidden /> recent files
        {familyCounts && familyCounts.size > 1 && (entries?.length ?? 0) > 3 ? (
          <span className="ml-1 font-mono text-[9px] font-normal normal-case tracking-normal text-zinc-600">
            {filtered.length} shown{family ? ` of ${entries?.length ?? 0}` : ""}
          </span>
        ) : null}
      </div>

      {/* family filter pills — only when the list is mixed */}
      {familyCounts && familyCounts.size > 1 && (entries?.length ?? 0) > 3 ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFamily(null)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors",
              family === null
                ? "border-emerald-800/70 bg-emerald-950/40 text-emerald-300"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
            )}
          >
            all {entries?.length ?? 0}
          </button>
          {[...familyCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([f, n]) => (
              <button
                key={f}
                type="button"
                onClick={() => setFamily(family === f ? null : f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors",
                  family === f
                    ? "border-emerald-800/70 bg-emerald-950/40 text-emerald-300"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", FAMILY_DOTS[f] ?? "bg-zinc-400")} aria-hidden />
                {FAMILY_LABELS[f] ?? f} {n}
              </button>
            ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {filtered.map((entry) => {
          const Icon = iconFor(entry.viewerId);
          const meta = `${
            entry.detectedName ? `${entry.detectedName} · ` : ""
          }${formatBytes(entry.size)} · ${formatRecentWhen(entry.lastOpened)}`;
          const isHinted = hint?.id === entry.id;
          const isBusy = busyId === entry.id;
          return (
            <div key={entry.id} className="group relative shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void openEntry(entry)}
                title={`${entry.name}\n${meta}`}
                className={cn(
                  "flex h-9 w-40 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 pl-3 pr-5 text-left transition-colors",
                  "hover:border-emerald-700 hover:bg-emerald-950/30",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500",
                  isHinted && "border-amber-700/70 bg-amber-950/20",
                  isBusy && "opacity-60",
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotFor(entry.viewerId), isBusy && "animate-pulse")}
                  aria-hidden
                />
                <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate font-mono text-[11px] leading-[13px] text-zinc-300 group-hover:text-emerald-200"
                    title={entry.name}
                  >
                    {entry.name}
                  </span>
                  <span
                    className="block truncate font-mono text-[9px] leading-[11px] text-zinc-600"
                    title={meta}
                  >
                    {meta}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${entry.name} from recent files`}
                onClick={() => removeEntry(entry.id)}
                className={cn(
                  "absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full",
                  "border border-zinc-700 bg-zinc-800 text-zinc-500 transition-all",
                  "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100",
                  "hover:border-rose-800/70 hover:bg-rose-950/70 hover:text-rose-300",
                  "focus-visible:pointer-events-auto focus-visible:opacity-100",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-rose-500",
                )}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </div>
          );
        })}

        {confirmClear ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-900/60 bg-rose-950/30 pl-2.5 pr-1.5 py-0.5 text-[11px]">
            <span className="text-zinc-400">clear all recents?</span>
            <button
              type="button"
              onClick={clearAll}
              className="rounded-full px-1.5 font-semibold text-rose-300 transition-colors hover:bg-rose-900/50 hover:text-rose-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
            >
              yes
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-full px-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-zinc-500"
            >
              no
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:border-rose-900/60 hover:bg-rose-950/20 hover:text-rose-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-rose-500"
          >
            clear all
          </button>
        )}
      </div>

      {hint ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" role="status">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
          <span className="max-w-[180px] truncate font-mono text-amber-200/90">{hint.name}</span>
          <span className="text-amber-400/60">not cached — re-open from disk</span>
        </div>
      ) : null}
    </section>
  );
}

export default RecentFilesRow;
