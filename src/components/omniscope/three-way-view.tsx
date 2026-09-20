"use client";

import * as React from "react";
import {
  ViewerToolbar, ToolButton, LoadingState, ErrorCard,
} from "@/components/viewers/viewer-ui";
import { cn, formatBytes } from "@/lib/utils";
import { decodeTextual, splitLines } from "@/lib/textdiff";
import { diff3, type Diff3Result, type Row3 } from "@/lib/diff3";
import {
  GitBranch, X, Equal, AlertTriangle, Loader2, Copy, Check, Download,
  ChevronLeft, ChevronRight, WrapText, FileDiff, ArrowLeft, CheckCheck,
} from "lucide-react";

const TEXT_CAP = 8 * 1024 * 1024; // decode cap per side
const LINE_CAP = 60_000; // line cap per side
const ROWS_PER_PAGE = 4000; // rendered-row pagination

/* ---------------- slot model ---------------- */

interface Slot3 {
  file: File | null;
  lines: string[] | null;
  hash: string | null;
  reading: boolean;
  enc: string | null;
  truncated: boolean;
  err: string | null;
}

const EMPTY: Slot3 = { file: null, lines: null, hash: null, reading: false, enc: null, truncated: false, err: null };

async function readSlot(file: File): Promise<Partial<Slot3>> {
  const head = file.size > TEXT_CAP ? await file.slice(0, TEXT_CAP).arrayBuffer() : await file.arrayBuffer();
  const bytes = new Uint8Array(head);
  const dec = decodeTextual(bytes);
  const lines = splitLines(dec.text);
  const capped = lines.length > LINE_CAP ? lines.slice(0, LINE_CAP) : lines;
  let hash = "";
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { hash = ""; }
  return {
    lines: capped,
    hash: hash || null,
    enc: dec.enc,
    truncated: file.size > TEXT_CAP || lines.length > LINE_CAP,
  };
}

/* slot card visual identity per role */
const ROLE_STYLE = {
  base: {
    label: "Base",
    badge: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    hint: "shared ancestor",
  },
  mine: {
    label: "Mine",
    badge: "border-teal-900/60 bg-teal-950/40 text-teal-300",
    hint: "your version",
  },
  theirs: {
    label: "Theirs",
    badge: "border-amber-900/60 bg-amber-950/30 text-amber-300",
    hint: "their version",
  },
} as const;

type Role = keyof typeof ROLE_STYLE;

function slot3Card(
  role: Role,
  slot: Slot3,
  onFile: (f: File | null) => void,
  inputRef: React.RefObject<HTMLInputElement | null>,
): React.ReactNode {
  const st = ROLE_STYLE[role];
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer?.files?.[0];
        if (f) onFile(f);
      }}
      className="group/slot flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5 transition-colors hover:border-emerald-800/70 hover:bg-zinc-900"
      onClick={() => inputRef.current?.click()}
      role="button"
      aria-label={`Choose file for ${st.label}`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
    >
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-bold", st.badge)}>
        {role === "base" ? "O" : role === "mine" ? "A" : "B"}
      </span>
      <div className="min-w-0 flex-1">
        {slot.file ? (
          <>
            <div className="truncate font-mono text-xs text-zinc-200" title={slot.file.name}>{slot.file.name}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
              <span className="shrink-0">{formatBytes(slot.file.size)}</span>
              <span className="shrink-0 text-zinc-600">{slot.lines != null ? `${slot.lines.length.toLocaleString()} ln` : ""}</span>
              {slot.truncated ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-amber-400/90"><AlertTriangle className="h-3 w-3" />capped</span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-xs text-zinc-500">
            <span className="text-zinc-300">Click or drop</span> — {st.hint}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ---------------- row rendering ---------------- */

function numCls(kind: Row3["kind"], col: "base" | "mine" | "theirs", active: boolean): string {
  const base = "w-11 shrink-0 select-none border-r pr-1.5 text-right text-[10px] tabular-nums";
  if (active) return cn(base, "border-rose-700/60 text-rose-300");
  return cn(base, "border-zinc-800/60", kind === "conflict" ? "text-rose-400/70" : "text-zinc-500");
}

function cellCls(kind: Row3["kind"], col: "base" | "mine" | "theirs"): string {
  const base = "min-w-0 flex-1 px-2.5 leading-5";
  switch (kind) {
    case "same":
      return cn(base, "text-zinc-400");
    case "both":
      return cn(base, col === "base" ? "text-zinc-400 line-through decoration-zinc-700" : "bg-emerald-950/30 text-emerald-100");
    case "mine":
      return cn(base, col === "base" ? "text-zinc-400 line-through decoration-zinc-700" : col === "mine" ? "bg-teal-950/50 text-teal-100" : "text-zinc-700");
    case "theirs":
      return cn(base, col === "base" ? "text-zinc-400 line-through decoration-zinc-700" : col === "theirs" ? "bg-amber-950/50 text-amber-100" : "text-zinc-700");
    case "conflict":
      if (col === "base") return cn(base, "text-zinc-400 italic");
      return cn(base, col === "mine" ? "bg-rose-950/60 text-rose-100" : "bg-amber-950/60 text-amber-100");
  }
}

function RowView({ row, active, wrap, resolved }: { row: Row3; active: boolean; wrap: boolean; resolved?: "mine" | "theirs" }) {
  const ws = wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre";
  return (
    <div
      data-conflict={row.conflict}
      className={cn(
        "flex items-start gap-0 border-b border-zinc-900/60 font-mono text-[11px]",
        active && "relative shadow-[inset_2px_0_0_0_#f43f5e]",
        resolved && "opacity-90",
      )}
    >
      <span className={numCls(row.kind, "base", active)}>{row.baseN != null ? row.baseN + 1 : ""}</span>
      <span className={cn(cellCls(row.kind, "base"), ws, "w-[calc(28%-2.75rem)] shrink-0")}>{row.baseText ?? " "}</span>
      <span className={numCls(row.kind, "mine", active)}>{row.mineN != null ? row.mineN + 1 : ""}</span>
      <span className={cn(cellCls(row.kind, "mine"), ws, "w-[calc(36%-2.75rem)] shrink-0", resolved === "theirs" && "opacity-45")}>{row.mineText ?? " "}</span>
      <span className={numCls(row.kind, "theirs", active)}>{row.theirsN != null ? row.theirsN + 1 : ""}</span>
      <span className={cn(cellCls(row.kind, "theirs"), ws, "w-[calc(36%-2.75rem)] shrink-0", resolved === "mine" && "opacity-45")}>{row.theirsText ?? " "}</span>
    </div>
  );
}

/** sticky-free separator row that starts each contested block, with per-block A/B resolve buttons */
function ConflictHeader({
  ordinal, total, resolved, active, onPick, onClear,
}: {
  ordinal: number;
  total: number;
  resolved: "mine" | "theirs" | undefined;
  active: boolean;
  onPick: (side: "mine" | "theirs") => void;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-y px-3 py-1",
        active
          ? "border-rose-800/60 bg-rose-950/25 shadow-[inset_2px_0_0_0_#f43f5e]"
          : "border-rose-900/40 bg-rose-950/15",
      )}
    >
      <GitBranch className="h-3 w-3 shrink-0 text-rose-400" aria-hidden />
      <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-wider text-rose-300 tabular-nums">
        conflict {ordinal}/{total}
      </span>
      {resolved ? (
        <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 font-mono text-[9px] text-emerald-300">
          <CheckCheck className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">resolved {resolved === "mine" ? "A · mine" : "B · theirs"}</span>
          <button
            type="button"
            onClick={onClear}
            className="ml-0.5 shrink-0 rounded-sm p-0.5 text-zinc-500 transition-colors hover:text-rose-300"
            title="Undo this choice"
            aria-label="Undo this resolution"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <span className="hidden truncate font-mono text-[9px] text-zinc-600 md:inline">pick a side for the merged output ↓</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPick("mine")}
          className={cn(
            "rounded border px-2.5 py-0.5 font-mono text-[10px] font-bold transition-all duration-100 hover:-translate-y-px active:scale-95",
            resolved === "mine"
              ? "border-teal-600 bg-teal-900/60 text-teal-100 shadow-[0_1px_4px_rgba(13,148,136,0.35)]"
              : "border-teal-900/60 text-teal-400 hover:border-teal-600 hover:bg-teal-950/50 hover:text-teal-200 hover:shadow-[0_1px_4px_rgba(13,148,136,0.25)]",
          )}
          title="Resolve this conflict with the Mine side (A)"
        >
          {resolved === "mine" ? <Check className="h-3 w-3" /> : "A"}
        </button>
        <button
          type="button"
          onClick={() => onPick("theirs")}
          className={cn(
            "rounded border px-2.5 py-0.5 font-mono text-[10px] font-bold transition-all duration-100 hover:-translate-y-px active:scale-95",
            resolved === "theirs"
              ? "border-amber-600 bg-amber-900/60 text-amber-100 shadow-[0_1px_4px_rgba(217,119,6,0.35)]"
              : "border-amber-900/60 text-amber-400 hover:border-amber-600 hover:bg-amber-950/50 hover:text-amber-200 hover:shadow-[0_1px_4px_rgba(217,119,6,0.25)]",
          )}
          title="Resolve this conflict with the Theirs side (B)"
        >
          {resolved === "theirs" ? <Check className="h-3 w-3" /> : "B"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- main component ---------------- */

export function ThreeWayView({
  initialBase, initialMine, initialTheirs, onExit, onClose,
}: {
  initialBase: File | null;
  initialMine: File | null;
  initialTheirs: File | null;
  /** back to two-way compare */
  onExit: () => void;
  /** close the compare mode entirely */
  onClose: () => void;
}) {
  const [slots, setSlots] = React.useState<Record<Role, Slot3>>({
    base: initialBase ? { ...EMPTY, file: initialBase } : EMPTY,
    mine: initialMine ? { ...EMPTY, file: initialMine } : EMPTY,
    theirs: initialTheirs ? { ...EMPTY, file: initialTheirs } : EMPTY,
  });
  const inputBase = React.useRef<HTMLInputElement | null>(null);
  const inputMine = React.useRef<HTMLInputElement | null>(null);
  const inputTheirs = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const [wrap, setWrap] = React.useState(true);
  const [shownRows, setShownRows] = React.useState(ROWS_PER_PAGE);
  const [curConflict, setCurConflict] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const [resolvedMode, setResolvedMode] = React.useState<"markers" | "mine" | "theirs">("markers");
  /** per-conflict-id resolution choice (overrides the global mode) */
  const [conflictRes, setConflictRes] = React.useState<Record<number, "mine" | "theirs">>({});

  const setFile = (role: Role) => (f: File | null) => {
    setSlots((s) => ({ ...s, [role]: { ...EMPTY, file: f } }));
  };

  /* read + hash each slot */
  React.useEffect(() => {
    (Object.keys(slots) as Role[]).forEach((role) => {
      const slot = slots[role];
      if (slot.file && !slot.reading && slot.lines == null && !slot.err) {
        setSlots((s) => ({ ...s, [role]: { ...s[role], reading: true } }));
        readSlot(slot.file)
          .then((res) => setSlots((s) => ({ ...s, [role]: { ...s[role], ...res, reading: false } })))
          .catch((e) => setSlots((s) => ({ ...s, [role]: { ...s[role], reading: false, err: String(e) } })));
      }
    });
  }, [slots]);

  const busy = (Object.values(slots) as Slot3[]).some((s) => s.reading);
  const ready = !!(slots.base.lines && slots.mine.lines && slots.theirs.lines);

  const result: (Diff3Result & { err?: string }) | null = React.useMemo(() => {
    if (!ready) return null;
    try {
      return diff3(slots.base.lines!, slots.mine.lines!, slots.theirs.lines!);
    } catch (e) {
      return { rows: [], stats: { same: 0, mineOnly: 0, theirsOnly: 0, bothSame: 0, conflicts: 0, conflictLines: 0, mineDel: 0, theirsDel: 0 }, merged: [], clean: false, err: String(e) };
    }
  }, [ready, slots.base.lines, slots.mine.lines, slots.theirs.lines]);

  const conflictIds = React.useMemo(() => {
    if (!result) return [] as number[];
    const ids: number[] = [];
    for (const r of result.rows) if (r.conflict != null && (ids.length === 0 || ids[ids.length - 1] !== r.conflict)) ids.push(r.conflict);
    return ids;
  }, [result]);

  function goConflict(idx: number) {
    if (!conflictIds.length) return;
    const i = (idx + conflictIds.length) % conflictIds.length;
    setCurConflict(i);
    const el = listRef.current?.querySelector(`[data-conflict="${conflictIds[i]}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* n/p conflict navigation · a/b per-conflict resolve · u undo */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "n") { e.preventDefault(); goConflict(curConflict + 1); }
      else if (e.key === "p") { e.preventDefault(); goConflict(curConflict - 1); }
      else if (e.key === "a" || e.key === "b") {
        const id = conflictIds[curConflict];
        if (id == null) return;
        e.preventDefault();
        const side = e.key === "a" ? "mine" as const : "theirs" as const;
        setConflictRes((m) => ({ ...m, [id]: side }));
        goConflict(curConflict + 1);
      } else if (e.key === "u") {
        const id = conflictIds[curConflict];
        if (id == null) return;
        e.preventDefault();
        setConflictRes((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [curConflict, conflictIds]);

  /* reset granular resolutions whenever the merge result changes */
  React.useEffect(() => {
    setConflictRes({});
  }, [result]);

  const resolvedText = React.useMemo(() => {
    if (!result) return "";
    const merged = result.merged;
    const out: string[] = [];
    let i = 0;
    let block = 0; // ordinal of the current marker block (matches conflict ids)
    while (i < merged.length) {
      if (merged[i] !== "<<<<<<< mine") { out.push(merged[i]); i++; continue; }
      block++;
      // per-conflict choice beats the global mode
      const choice = conflictRes[block - 1] ?? (resolvedMode === "markers" ? null : resolvedMode);
      i++;
      const mineLines: string[] = [];
      while (i < merged.length && merged[i] !== "=======" && merged[i] !== ">>>>>>> theirs") { mineLines.push(merged[i]); i++; }
      const hasSep = merged[i] === "=======";
      if (hasSep) i++;
      const theirsLines: string[] = [];
      while (i < merged.length && merged[i] !== ">>>>>>> theirs") { theirsLines.push(merged[i]); i++; }
      if (merged[i] === ">>>>>>> theirs") i++;
      if (choice === "mine") out.push(...mineLines);
      else if (choice === "theirs") out.push(...theirsLines);
      else out.push("<<<<<<< mine", ...mineLines, "=======", ...theirsLines, ">>>>>>> theirs");
    }
    return out.join("\n") + "\n";
  }, [result, resolvedMode, conflictRes]);

  /** conflicts resolved so far (granular + global modes) */
  const resolvedCount = conflictIds.length
    ? (resolvedMode === "markers" ? Object.keys(conflictRes).length : conflictIds.length)
    : 0;
  const allResolved = conflictIds.length > 0 && resolvedCount === conflictIds.length;

  function copyMerged() {
    if (!resolvedText) return;
    void navigator.clipboard?.writeText(resolvedText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadMerged() {
    if (!result) return;
    const baseName = (slots.mine.file?.name.replace(/\.[^.]+$/, "") || "merge");
    const blob = new Blob([resolvedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resolvedMode !== "markers"
      ? `${baseName}.resolved-${resolvedMode}.txt`
      : allResolved ? `${baseName}.resolved.txt` : `${baseName}.merged.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const s = result?.stats;
  const identical3 = !!(slots.base.hash && slots.mine.hash && slots.theirs.hash &&
    slots.base.hash === slots.mine.hash && slots.mine.hash === slots.theirs.hash);

  const rendered = result ? result.rows.slice(0, shownRows) : [];
  const hasMore = result ? result.rows.length > shownRows : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ViewerToolbar
        left={
          <>
            <ToolButton label="2-way" onClick={onExit} title="Back to two-way compare">
              <ArrowLeft className="h-3.5 w-3.5" />
            </ToolButton>
            <span className="hidden items-center gap-1.5 pl-1 font-mono text-[10px] text-zinc-500 sm:flex">
              <GitBranch className="h-3.5 w-3.5 text-rose-400" />
              three-way merge
            </span>
          </>
        }
        center={
          <>
            <ToolButton label="Wrap" active={wrap} onClick={() => setWrap((v) => !v)} title="Toggle line wrapping">
              <WrapText className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
        right={
          <ToolButton label="Close compare" onClick={onClose}><X className="h-3.5 w-3.5" /></ToolButton>
        }
      />

      {/* slots */}
      <div className="flex shrink-0 flex-wrap items-stretch gap-2 border-b border-zinc-800/80 bg-zinc-950 p-3">
        {slot3Card("base", slots.base, setFile("base"), inputBase)}
        <div className="flex shrink-0 items-center text-zinc-600"><GitBranch className="h-4 w-4 rotate-180" /></div>
        {slot3Card("mine", slots.mine, setFile("mine"), inputMine)}
        <div className="flex shrink-0 items-center text-zinc-600"><GitBranch className="h-4 w-4" /></div>
        {slot3Card("theirs", slots.theirs, setFile("theirs"), inputTheirs)}
      </div>

      {/* verdict + stats */}
      <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-900/30 px-3 py-2">
        {busy ? (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
            Reading &amp; hashing…
          </div>
        ) : slots.base.err || slots.mine.err || slots.theirs.err ? (
          <ErrorCard title="Read error" message={slots.base.err ?? slots.mine.err ?? slots.theirs.err ?? ""} />
        ) : identical3 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            <Equal className="h-4 w-4" />
            All three files are byte-identical
            <span className="ml-auto font-mono text-[10px] text-emerald-400/70">sha256 match</span>
          </div>
        ) : result && s ? (
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            {result.clean ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300">
                <CheckCheck className="h-3 w-3" />clean merge — no conflicts
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-900/60 bg-rose-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200 tabular-nums">
                <AlertTriangle className="h-3 w-3" />{s.conflicts} conflict{s.conflicts === 1 ? "" : "s"} · {s.conflictLines} lines
              </span>
            )}
            <span className="rounded-full border border-teal-900/60 bg-teal-950/40 px-2 py-0.5 text-teal-300 tabular-nums">mine {s.mineOnly + s.mineDel} chg</span>
            <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300 tabular-nums">theirs {s.theirsOnly + s.theirsDel} chg</span>
            {s.bothSame > 0 ? (
              <span className="rounded-full border border-emerald-900/60 bg-emerald-950/30 px-2 py-0.5 text-emerald-300 tabular-nums">same edit {s.bothSame}</span>
            ) : null}
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 tabular-nums">{s.same.toLocaleString()} unchanged</span>
            {(s.mineDel > 0 || s.theirsDel > 0) ? (
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-400 tabular-nums">
                del {s.mineDel}M/{s.theirsDel}T
              </span>
            ) : null}
            {(slots.base.truncated || slots.mine.truncated || slots.theirs.truncated) ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">
                <AlertTriangle className="h-3 w-3" />text window: first {formatBytes(TEXT_CAP)} / {LINE_CAP.toLocaleString()} lines per side
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <FileDiff className="h-3.5 w-3.5" />
            Load a shared base plus two derived versions — Omniscope computes a diff3-style merge
          </div>
        )}
      </div>

      {/* conflict navigator + merged output actions */}
      {result && !result.clean && conflictIds.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5">
          <ToolButton label="Previous conflict" onClick={() => goConflict(curConflict - 1)} title="Previous conflict (p)">
            <ChevronLeft className="h-3.5 w-3.5" />
          </ToolButton>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
            conflict {Math.min(curConflict + 1, conflictIds.length)} / {conflictIds.length}
          </span>
          <ToolButton label="Next conflict" onClick={() => goConflict(curConflict + 1)} title="Next conflict (n)">
            <ChevronRight className="h-3.5 w-3.5" />
          </ToolButton>
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 font-mono text-[9px] text-zinc-400 sm:inline-flex">
            <kbd className="rounded border border-zinc-600 bg-zinc-900 px-1 text-zinc-300">n</kbd>/<kbd className="rounded border border-zinc-600 bg-zinc-900 px-1 text-zinc-300">p</kbd>
            navigate
          </span>
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900/60 px-2 py-0.5 font-mono text-[9px] text-zinc-400 xl:inline-flex" title="Keyboard: a = keep mine, b = keep theirs for the focused conflict, u = undo">
            <kbd className="rounded border border-teal-700 bg-teal-950/60 px-1 text-teal-300">a</kbd>
            <kbd className="rounded border border-amber-700 bg-amber-950/60 px-1 text-amber-300">b</kbd>
            <kbd className="rounded border border-zinc-600 bg-zinc-900 px-1 text-zinc-300">u</kbd>
            resolve
          </span>
          <span className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-[9px] text-zinc-400 lg:inline-flex" title="Legend: contested lines are tinted per side">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500/60" aria-hidden />
            contested rows are tinted
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden font-mono text-[9px] uppercase tracking-wider text-zinc-600 sm:inline">resolve</span>
            <ToolButton
              label="Markers"
              active={resolvedMode === "markers" && Object.keys(conflictRes).length === 0}
              onClick={() => { setResolvedMode("markers"); setConflictRes({}); }}
              title="Keep <<<<<<< / >>>>>>> markers (resets per-block choices)"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="All mine" active={resolvedMode === "mine"} onClick={() => { setResolvedMode("mine"); setConflictRes({}); }} title="Resolve every conflict with the Mine side">
              <span className="font-mono text-[10px] font-bold text-teal-300">A</span>
            </ToolButton>
            <ToolButton label="All theirs" active={resolvedMode === "theirs"} onClick={() => { setResolvedMode("theirs"); setConflictRes({}); }} title="Resolve every conflict with the Theirs side">
              <span className="font-mono text-[10px] font-bold text-amber-300">B</span>
            </ToolButton>
          </div>
        </div>
      ) : null}

      {/* merged output row */}
      {result ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5">
          <span className="font-mono text-[10px] text-zinc-500">
            merged output · {result.merged.length.toLocaleString()} lines
            {conflictIds.length > 0
              ? resolvedMode !== "markers"
                ? ` · all resolved by ${resolvedMode}`
                : ` · ${resolvedCount}/${conflictIds.length} conflicts resolved`
              : " · no conflicts"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <ToolButton label="Copy merged" onClick={copyMerged} title="Copy merged result to clipboard">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton label="Save .txt" onClick={downloadMerged} title="Download merged result">
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </div>
        </div>
      ) : null}

      {/* main pane */}
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-auto bg-zinc-950 scrollbar-thin">
        {!ready ? (
          busy ? (
            <LoadingState label="Reading files…" />
          ) : (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-md">
                <GitBranch className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
                <div className="text-sm font-medium text-zinc-300">Three-way merge</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                  Load a common ancestor plus the two divergent versions. Omniscope computes each side&apos;s
                  changes against the base, auto-merges independent edits, and highlights genuine conflicts —
                  then exports the merged result with (or resolved from) classic conflict markers.
                </p>
                <div className="mt-3 flex items-center justify-center gap-3 font-mono text-[10px] text-zinc-600">
                  <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5">base O</span>
                  <span className="rounded border border-teal-900/60 bg-teal-950/40 px-2 py-0.5 text-teal-400">mine A</span>
                  <span className="rounded border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-400">theirs B</span>
                </div>
              </div>
            </div>
          )
        ) : (
          <div>
            {/* column headers */}
            <div className="sticky top-0 z-10 flex items-center gap-0 border-b border-zinc-800 bg-zinc-900/95 px-0 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider backdrop-blur">
              <span className="w-11 shrink-0 border-r pr-1.5 text-right text-zinc-600">ln</span>
              <span className="w-[calc(28%-2.75rem)] shrink-0 px-2.5 text-zinc-400">base</span>
              <span className="w-11 shrink-0 border-r pr-1.5 text-right text-zinc-600">ln</span>
              <span className="w-[calc(36%-2.75rem)] shrink-0 px-2.5 text-teal-400">mine</span>
              <span className="w-11 shrink-0 border-r pr-1.5 text-right text-zinc-600">ln</span>
              <span className="w-[calc(36%-2.75rem)] shrink-0 px-2.5 text-amber-400">theirs</span>
            </div>
            {rendered.map((row, i) => {
              const isBlockStart = row.conflict != null && (i === 0 || rendered[i - 1].conflict !== row.conflict);
              const resolvedSide = row.conflict != null ? conflictRes[row.conflict] : undefined;
              return (
                <React.Fragment key={i}>
                  {isBlockStart ? (
                    <ConflictHeader
                      ordinal={conflictIds.indexOf(row.conflict!) + 1}
                      total={conflictIds.length}
                      resolved={resolvedSide}
                      active={row.conflict === conflictIds[curConflict]}
                      onPick={(side) => setConflictRes((m) => ({ ...m, [row.conflict!]: side }))}
                      onClear={() => setConflictRes((m) => {
                        const n = { ...m };
                        delete n[row.conflict!];
                        return n;
                      })}
                    />
                  ) : null}
                  <RowView row={row} wrap={wrap} active={row.conflict != null && row.conflict === conflictIds[curConflict]} resolved={resolvedSide} />
                </React.Fragment>
              );
            })}
            {hasMore ? (
              <div className="flex items-center justify-center gap-3 border-t border-zinc-800 bg-zinc-900/40 py-3">
                <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                  {shownRows.toLocaleString()} of {result!.rows.length.toLocaleString()} rows rendered
                </span>
                <button
                  type="button"
                  onClick={() => setShownRows((n) => n + ROWS_PER_PAGE)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-[10px] text-zinc-300 transition-colors hover:border-emerald-700 hover:text-emerald-300"
                >
                  render {ROWS_PER_PAGE.toLocaleString()} more
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThreeWayView;
