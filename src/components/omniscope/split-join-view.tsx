"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Chip, Field, InfoGrid, SectionCard } from "@/components/viewers/viewer-ui";
import { analyzeSegments, JOIN_SIZE_CAP, joinFiles, type SegmentAnalysis } from "@/lib/splitjoin";
import { cn, formatBytes } from "@/lib/utils";
import {
  AlertTriangle, CheckCircle2, Combine, Download, FileStack, FolderPlus, Link2, Loader2, X,
} from "lucide-react";

export interface SplitJoinViewProps {
  initialFiles?: File[];
  onOpenMerged: (file: File) => void;
  onClose: () => void;
}

const KIND_LABELS: Record<SegmentAnalysis["kind"], string> = {
  numeric: "numeric .NNN",
  rxx: "RAR .rNN",
  partN: "RAR .partN",
  zipx: "PKZIP .zNN",
  unknown: "unknown",
};

const PATTERN_HELP: { pattern: string; desc: string; example: string }[] = [
  { pattern: ".001 … .999", desc: "HJSplit / 7-Zip split volumes", example: "backup.7z.001 + backup.7z.002 + …" },
  { pattern: ".rar + .r00 … .r99", desc: "old-style RAR volumes (.rar is the first volume)", example: "backup.rar + backup.r00 + backup.r01" },
  { pattern: ".part1.rar … .partN.rar", desc: "new-style RAR multi-volume", example: "movie.part1.rar + movie.part2.rar" },
  { pattern: ".z01 … .zNN + .zip", desc: "PKZIP spanning (.zip is the last part)", example: "data.z01 + data.z02 + data.zip" },
];

function fileKey(f: File): string {
  return `${f.name}|${f.size}`;
}

/** Reconstruct the filename a missing segment index refers to. */
function missingLabel(analysis: SegmentAnalysis, index: number): string {
  const base = analysis.base;
  switch (analysis.kind) {
    case "numeric":
      return `${base}.${String(index).padStart(3, "0")}`;
    case "rxx":
      return index === 0 ? `${base}.rar` : `${base}.r${String(index - 1).padStart(2, "0")}`;
    case "partN":
      return `${base}.part${index}.rar`;
    case "zipx": {
      // an index beyond the highest .zNN present means the trailing .zip is missing
      let maxZ = 0;
      for (const f of analysis.files) {
        const m = /\.z(\d{2})$/i.exec(f.name);
        if (m) maxZ = Math.max(maxZ, parseInt(m[1], 10));
      }
      return index > maxZ ? `${base}.zip` : `${base}.z${String(index).padStart(2, "0")}`;
    }
    default:
      return `part ${index}`;
  }
}

/**
 * Split-file joiner: drop or browse the segments of one set, Omniscope detects
 * the numbering pattern, concatenates them in-browser and hands the merged
 * file back to the app (or downloads it). Rendered as a full-height overlay;
 * call onClose() (or press Esc) to dismiss.
 */
export function SplitJoinView({ initialFiles, onOpenMerged, onClose }: SplitJoinViewProps): React.JSX.Element {
  const [files, setFiles] = React.useState<File[]>(() => {
    const seen = new Set<string>();
    return (initialFiles ?? []).filter((f) => {
      const k = fileKey(f);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
  // per-suggestion name overrides — keeps the merged-name input fully derived
  // from the current analysis while remembering the user's edits
  const [nameOverrides, setNameOverrides] = React.useState<Record<string, string>>({});
  const [joining, setJoining] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = React.useState<{ blob: Blob; name: string; url: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const urlRef = React.useRef<string | null>(null);

  const analysis = React.useMemo(() => analyzeSegments(files), [files]);
  const suggestion = analysis?.mergedName ?? "";
  const mergedName = nameOverrides[suggestion] ?? suggestion;

  // release the joined blob's object URL on unmount
  React.useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  // Escape closes this view; capture phase keeps the app-level Esc handler quiet
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const clearResult = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setResult(null);
  };

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return;
    setFiles((cur) => {
      const keys = new Set(cur.map(fileKey));
      const next = [...cur];
      for (const f of incoming) {
        const k = fileKey(f);
        if (keys.has(k)) continue;
        keys.add(k);
        next.push(f);
      }
      return next;
    });
    clearResult();
    setError(null);
  };

  const removeFile = (index: number) => {
    setFiles((cur) => cur.filter((_, i) => i !== index));
    clearResult();
    setError(null);
  };

  const clearAll = () => {
    setFiles([]);
    clearResult();
    setError(null);
    setProgress(null);
    setNameOverrides({});
  };

  const doJoin = async () => {
    if (!analysis || joining) return;
    setError(null);
    clearResult();
    setJoining(true);
    setProgress({ done: 0, total: analysis.files.reduce((s, f) => s + f.size, 0) });
    try {
      const blob = await joinFiles(analysis.files, (done, total) => setProgress({ done, total }));
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setResult({ blob, name: mergedName.trim() || suggestion || "merged.bin", url });
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJoining(false);
    }
  };

  const openMerged = () => {
    if (!result) return;
    const name = mergedName.trim() || result.name || "merged.bin";
    onOpenMerged(new File([result.blob], name, { type: "application/octet-stream" }));
  };

  const totalBytes = analysis ? analysis.files.reduce((s, f) => s + f.size, 0) : 0;
  const oversize = analysis !== null && totalBytes > JOIN_SIZE_CAP;
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  const downloadName = result ? (mergedName.trim() || result.name) : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Join split files"
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 text-zinc-100 backdrop-blur-sm antialiased"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer?.files ?? []));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {/* header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/95 px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950/40">
          <Combine className="h-4 w-4 text-emerald-400" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">Join split files</h2>
          <p className="text-[10px] text-zinc-500">concatenate split &amp; multi-volume sets — 100% in your browser</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close split-file joiner"
          title="Close (Esc)"
          className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-rose-800 hover:text-rose-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          {/* drop zone / add segments */}
          <button
            type="button"
            autoFocus
            onClick={() => inputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragging(false);
              addFiles(Array.from(e.dataTransfer?.files ?? []));
            }}
            aria-label="Add segment files — click to browse, or drop segment files here"
            className={cn(
              "group flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              "focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500",
              dragging
                ? "border-emerald-500 bg-emerald-950/30"
                : "border-zinc-700 bg-zinc-900/40 hover:border-emerald-700 hover:bg-zinc-900/70",
            )}
          >
            <FolderPlus
              className={cn("h-9 w-9", dragging ? "text-emerald-400" : "text-zinc-500 group-hover:text-emerald-400")}
            />
            <span className="text-sm font-semibold text-zinc-200">Drop segment files here</span>
            <span className="text-xs text-zinc-500">
              or <span className="text-emerald-300 underline-offset-2 group-hover:underline">click to browse</span>
              {" "}— .001, .r00, .part1.rar, .z01 …
            </span>
          </button>

          {/* working set */}
          {files.length > 0 ? (
            <SectionCard
              title="Working set"
              icon={<FileStack className="h-3.5 w-3.5 text-teal-300" />}
              right={
                <div className="flex items-center gap-1.5">
                  <Chip tone="zinc">
                    {files.length} file{files.length === 1 ? "" : "s"}
                  </Chip>
                  <button
                    type="button"
                    onClick={clearAll}
                    aria-label="Clear working set"
                    className="inline-flex h-6 items-center rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-medium text-zinc-400 transition-colors hover:border-rose-800 hover:text-rose-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
                  >
                    Clear
                  </button>
                </div>
              }
            >
              <ul className="max-h-44 overflow-y-auto scrollbar-thin">
                {files.map((f, i) => (
                  <li key={fileKey(f)} className="flex items-center gap-2 py-1">
                    <span className="w-6 shrink-0 text-right font-mono text-[10px] text-zinc-600">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300" title={f.name}>
                      {f.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                      {formatBytes(f.size, 0)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                      className="shrink-0 rounded p-1 text-zinc-600 transition-colors hover:text-rose-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {/* detected pattern / instructions */}
          {analysis ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <SectionCard
                title="Detected pattern"
                icon={<Link2 className="h-3.5 w-3.5 text-emerald-300" />}
                right={
                  <div className="flex items-center gap-1.5">
                    <Chip tone="teal">{KIND_LABELS[analysis.kind]}</Chip>
                    {analysis.complete ? (
                      <Chip tone="emerald">
                        <CheckCircle2 className="h-3 w-3" /> complete
                      </Chip>
                    ) : (
                      <Chip tone="amber">
                        <AlertTriangle className="h-3 w-3" /> {analysis.missing.length} missing
                      </Chip>
                    )}
                  </div>
                }
              >
                <InfoGrid>
                  <Field label="Base" mono>{analysis.base}</Field>
                  <Field label="Pattern">{analysis.pattern}</Field>
                  <Field label="Segments" mono>
                    {analysis.count} parts · {formatBytes(totalBytes)} total
                  </Field>
                </InfoGrid>

                {!analysis.complete ? (
                  <div className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/20 p-2.5" role="status">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Missing segments — the joined file will be broken without them
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {analysis.missing.map((idx) => (
                        <Chip key={idx} tone="amber" className="font-mono">
                          {missingLabel(analysis, idx)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}

                <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto scrollbar-thin">
                  {analysis.files.map((f, i) => (
                    <li
                      key={fileKey(f)}
                      className="flex items-center gap-2 rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5"
                    >
                      <span className="inline-flex h-5 w-8 shrink-0 items-center justify-center rounded border border-emerald-900/60 bg-emerald-950/40 font-mono text-[10px] text-emerald-300">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                        {formatBytes(f.size, 0)}
                      </span>
                    </li>
                  ))}
                </ol>

                <label className="mt-3 flex items-center gap-2 text-xs">
                  <span className="shrink-0 text-zinc-500">Merged name</span>
                  <input
                    value={mergedName}
                    onChange={(e) => setNameOverrides((cur) => ({ ...cur, [suggestion]: e.target.value }))}
                    spellCheck={false}
                    aria-label="Merged file name"
                    className="h-7 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-xs text-zinc-200 outline-none transition-colors focus:border-emerald-600"
                  />
                </label>
              </SectionCard>
            </motion.div>
          ) : (
            <SectionCard
              title="Recognized split patterns"
              icon={<Link2 className="h-3.5 w-3.5 text-emerald-300" />}
              right={<Chip tone="zinc">{files.length} in working set</Chip>}
            >
              <p className="mb-3 text-xs text-zinc-400">
                {files.length
                  ? "These files don't form a recognizable split set yet — add the remaining segments of one set (extra unrelated files are ignored)."
                  : "Add all segments of one set — they are joined locally, nothing is uploaded."}
              </p>
              <ul className="space-y-2">
                {PATTERN_HELP.map((p) => (
                  <li key={p.pattern} className="rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-2">
                    <div className="font-mono text-xs font-semibold text-emerald-300">{p.pattern}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">{p.desc}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600" title={p.example}>
                      e.g. {p.example}
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {/* result */}
          {result ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
              <section className="rounded-lg border border-emerald-800/60 bg-emerald-950/20">
                <header className="flex items-center gap-1.5 border-b border-emerald-900/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Join complete
                </header>
                <div className="p-3">
                  <InfoGrid>
                    <Field label="Merged file" mono>{result.name}</Field>
                    <Field label="Size" mono>{formatBytes(result.blob.size)}</Field>
                    <Field label="Parts" mono>{analysis?.count ?? "—"}</Field>
                  </InfoGrid>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openMerged}
                      aria-label="Open merged file in Omniscope"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-lg shadow-emerald-950/40 transition-colors hover:bg-emerald-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-400"
                    >
                      <Combine className="h-3.5 w-3.5" />
                      Open in Omniscope
                    </button>
                    <a
                      href={result.url}
                      download={downloadName}
                      aria-label="Download merged file"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-emerald-700 hover:text-emerald-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>
                </div>
              </section>
            </motion.div>
          ) : null}

          {/* error */}
          {error ? (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-rose-900/50 bg-rose-950/30 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-rose-200">Join failed</div>
                <div className="mt-0.5 break-words text-xs text-rose-300/80">{error}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* action footer */}
      <footer className="shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          {joining && progress ? (
            <div className="flex items-center gap-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Join progress">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                {formatBytes(progress.done, 0)} / {formatBytes(progress.total, 0)}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="min-w-0 truncate text-xs text-zinc-500">
              {analysis
                ? `${analysis.count} segments · ${formatBytes(totalBytes, 0)} → ${mergedName || "merged file"}`
                : "No split set detected yet"}
            </span>
            {oversize ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                over the {Math.round(JOIN_SIZE_CAP / (1024 * 1024))} MB in-browser cap
              </span>
            ) : null}
            <button
              type="button"
              onClick={doJoin}
              disabled={!analysis || joining}
              aria-label="Join files into one"
              className={cn(
                "ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 transition-colors",
                "focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-400",
                (!analysis || joining) && "cursor-not-allowed opacity-40 hover:bg-emerald-600",
              )}
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Combine className="h-4 w-4" />}
              {joining ? "Joining…" : "Join files"}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default SplitJoinView;
