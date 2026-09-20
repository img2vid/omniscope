"use client";

import * as React from "react";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, Chip, LoadingState, ErrorCard, Segmented,
} from "@/components/viewers/viewer-ui";
import { ThreeWayView } from "./three-way-view";
import { cn, formatBytes, toHexByte } from "@/lib/utils";
import {
  diffLines, textDiffStats, buildUnifiedPatch, splitLines, decodeTextual, looksTextual, wordDiff,
  type LineOp, type TextDiffStats, type WordDiffResult,
} from "@/lib/textdiff";
import {
  loadHljs, detectLang, autoDetectLang, tokenizeLines, sliceTokens, type LineTok,
} from "@/lib/hlsyntax";
import {
  GitCompare, ArrowLeftRight, X, ChevronLeft, ChevronRight, Equal, AlertTriangle,
  Loader2, FileDiff, Copy, Check, Download, WrapText, Rows3, Columns2, Plus, Minus, Highlighter,
  Code2, GitBranch,
} from "lucide-react";

const PAGE = 4096; // bytes per page
const ROW = 16; // bytes per row
const COMPARE_CAP = 128 * 1024 * 1024; // full-compare window cap per side
const TEXT_CAP = 8 * 1024 * 1024; // text-mode decode cap per side
const LINE_CAP = 60_000; // text-mode line cap per side
const CTX = 3; // context lines kept around changes
const COLLAPSE_OVER = 8; // equal runs longer than this get collapsed
const ROWS_PER_PAGE = 4000; // rendered-row pagination
const SYNTAX_CHAR_CAP = 400_000; // per-side char cap for hl.js tokenization
const SYNTAX_LINE_CAP = 20_000; // per-side line cap for hl.js tokenization

/* hl.js token palette scoped to .dxhl (mirrors the code viewer — no blue/indigo) */
const HL_PALETTE_CSS = `
.dxhl .hljs-keyword, .dxhl .hljs-selector-tag, .dxhl .hljs-built_in, .dxhl .hljs-doctag { color: #6ee7b7; }
.dxhl .hljs-string, .dxhl .hljs-regexp, .dxhl .hljs-quote { color: #fcd34d; }
.dxhl .hljs-number, .dxhl .hljs-literal { color: #fda4af; }
.dxhl .hljs-comment { color: #71717a; font-style: italic; }
.dxhl .hljs-title, .dxhl .hljs-name, .dxhl .hljs-type, .dxhl .hljs-class, .dxhl .hljs-selector-id, .dxhl .hljs-selector-class { color: #5eead4; }
.dxhl .hljs-attr, .dxhl .hljs-attribute, .dxhl .hljs-variable, .dxhl .hljs-template-variable, .dxhl .hljs-params { color: #c4b5fd; }
.dxhl .hljs-symbol, .dxhl .hljs-bullet, .dxhl .hljs-meta, .dxhl .hljs-meta .hljs-keyword { color: #fdba74; }
.dxhl .hljs-section, .dxhl .hljs-emphasis { font-style: italic; }
.dxhl .hljs-strong { font-weight: 600; }
.dxhl .hljs-addition { color: #a7f3d0; }
.dxhl .hljs-deletion { color: #fecdd3; }
.dxhl .hljs-link { color: #5eead4; text-decoration: underline; }
`;

export interface DiffHunk {
  start: number;
  /** exclusive end */
  end: number;
  /** true when this hunk represents the tail of the longer file (past the shorter file's EOF) */
  tail: boolean;
}

/**
 * Compute contiguous differing regions between two byte arrays.
 * Runs closer than 16 bytes are merged into one hunk. The length difference
 * (bytes past min(lenA, lenB)) becomes a final hunk flagged with tail=true.
 */
export function computeDiffHunks(a: Uint8Array, b: Uint8Array): DiffHunk[] {
  const n = Math.min(a.length, b.length);
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let gap = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      if (cur && gap > 0 && gap < 16 && cur.end === i - gap) {
        // extend current hunk across the small gap
        cur.end = i + 1;
      } else {
        if (cur) hunks.push(cur);
        cur = { start: i, end: i + 1, tail: false };
      }
      gap = 0;
    } else if (cur) {
      gap++;
    }
    if (hunks.length >= 5000) break;
  }
  if (cur) hunks.push(cur);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen > n) hunks.push({ start: n, end: maxLen, tail: true });
  return hunks;
}

interface SyntaxState {
  lang: string;
  tokA: LineTok[][] | null;
  tokB: LineTok[][] | null;
  capped: boolean;
}

interface SlotState {
  file: File | null;
  bytes: Uint8Array | null;
  hash: string | null;
  reading: boolean;
  truncated: boolean;
}

const emptySlot: SlotState = { file: null, bytes: null, hash: null, reading: false, truncated: false };

async function sha256Chunks(file: File, cap: number, onProgress?: (done: number) => void): Promise<string> {
  const limit = Math.min(file.size, cap);
  const parts: ArrayBuffer[] = [];
  const CH = 8 * 1024 * 1024;
  for (let off = 0; off < limit; off += CH) {
    const end = Math.min(off + CH, limit);
    parts.push(await file.slice(off, end).arrayBuffer());
    onProgress?.(Math.min(end, limit));
  }
  const total = parts.reduce((s, p) => s + p.byteLength, 0);
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { merged.set(new Uint8Array(p), pos); pos += p.byteLength; }
  const dig = await crypto.subtle.digest("SHA-256", merged);
  return Array.from(new Uint8Array(dig)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function hexOffset(n: number): string {
  return "0x" + n.toString(16).toUpperCase().padStart(8, "0");
}

/* ------------------------------ text-mode model ------------------------------ */

interface TextSide {
  lines: string[];
  enc: string;
  truncatedBytes: boolean;
  truncatedLines: boolean;
  noNewline: boolean;
}

function buildTextSide(bytes: Uint8Array): TextSide {
  const truncatedBytes = bytes.length > TEXT_CAP;
  const slice = truncatedBytes ? bytes.subarray(0, TEXT_CAP) : bytes;
  const dec = decodeTextual(slice);
  const all = splitLines(dec.text);
  const truncatedLines = all.length > LINE_CAP;
  const lines = truncatedLines ? all.slice(0, LINE_CAP) : all;
  return {
    lines,
    enc: dec.enc,
    truncatedBytes,
    truncatedLines,
    noNewline: dec.text.length > 0 && !/[\r\n]$/.test(dec.text),
  };
}

type USegItem = { op: LineOp; i: number };

type USeg =
  | { type: "rows"; items: USegItem[]; block?: number }
  | { type: "gap"; from: number; to: number; count: number; id: number };

interface SRow {
  kind: "eq" | "del" | "ins" | "mod";
  aN?: number;
  aText?: string;
  bN?: number;
  bText?: string;
  aParts?: WordPartView[];
  bParts?: WordPartView[];
  block?: number;
}

type WordPartView = { text: string; changed: boolean };

export function DiffView({ initialA, initialB, onClose }: {
  initialA?: File | null;
  initialB?: File | null;
  onClose: () => void;
}): React.JSX.Element {
  const [slotA, setSlotA] = React.useState<SlotState>(initialA ? { ...emptySlot, file: initialA } : emptySlot);
  const [slotB, setSlotB] = React.useState<SlotState>(initialB ? { ...emptySlot, file: initialB } : emptySlot);
  const [scan, setScan] = React.useState<{ equal: number; hunks: DiffHunk[]; firstDiff: number | null; windowBytes: number } | null>(null);
  const [hashErr, setHashErr] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [curHunk, setCurHunk] = React.useState(-1);
  const [jump, setJump] = React.useState("");
  const [jumpErr, setJumpErr] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [dmode, setDmode] = React.useState<"bytes" | "text">("bytes");
  const [textView, setTextView] = React.useState<"unified" | "split">("unified");
  const [wrap, setWrap] = React.useState(false);
  const [wordHl, setWordHl] = React.useState(true);
  const [syntaxOn, setSyntaxOn] = React.useState(true);
  const [syntax, setSyntax] = React.useState<SyntaxState | null>(null);
  const [curBlock, setCurBlock] = React.useState(0);
  const [expandedGaps, setExpandedGaps] = React.useState<ReadonlySet<number>>(new Set());
  const [shownRows, setShownRows] = React.useState(ROWS_PER_PAGE);
  const [patchCopied, setPatchCopied] = React.useState(false);
  const [threeway, setThreeway] = React.useState(false);
  const modeTouched = React.useRef(false);
  const inputA = React.useRef<HTMLInputElement>(null);
  const inputB = React.useRef<HTMLInputElement>(null);

  /* read + hash each slot whenever its file changes */
  React.useEffect(() => {
    const file = slotA.file;
    if (!file) return;
    let cancelled = false;
    setSlotA((s) => ({ ...s, reading: true, bytes: null, hash: null, truncated: file.size > COMPARE_CAP }));
    (async () => {
      try {
        const want = Math.min(file.size, COMPARE_CAP);
        const bytes = new Uint8Array(await file.slice(0, want).arrayBuffer());
        const hash = await sha256Chunks(file, COMPARE_CAP);
        if (!cancelled) setSlotA((s) => ({ ...s, bytes, hash, reading: false }));
      } catch (e) {
        if (!cancelled) { setSlotA((s) => ({ ...s, reading: false })); setHashErr(String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [slotA.file]);

  React.useEffect(() => {
    const file = slotB.file;
    if (!file) return;
    let cancelled = false;
    setSlotB((s) => ({ ...s, reading: true, bytes: null, hash: null, truncated: file.size > COMPARE_CAP }));
    (async () => {
      try {
        const want = Math.min(file.size, COMPARE_CAP);
        const bytes = new Uint8Array(await file.slice(0, want).arrayBuffer());
        const hash = await sha256Chunks(file, COMPARE_CAP);
        if (!cancelled) setSlotB((s) => ({ ...s, bytes, hash, reading: false }));
      } catch (e) {
        if (!cancelled) { setSlotB((s) => ({ ...s, reading: false })); setHashErr(String(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [slotB.file]);

  /* reset view state when either file changes */
  React.useEffect(() => {
    setExpandedGaps(new Set());
    setShownRows(ROWS_PER_PAGE);
    setCurBlock(0);
  }, [slotA.file, slotB.file]);

  /* auto mode: text when both sides look textual (until the user picks manually) */
  React.useEffect(() => {
    if (modeTouched.current) return;
    const a = slotA.bytes, b = slotB.bytes;
    if (a && b && a.length > 0 && b.length > 0) {
      setDmode(looksTextual(a) && looksTextual(b) ? "text" : "bytes");
    }
  }, [slotA.bytes, slotB.bytes]);

  const busy = slotA.reading || slotB.reading;

  /* scan for differences once both sides are ready */
  React.useEffect(() => {
    if (busy || !slotA.bytes || !slotB.bytes) { setScan(null); return; }
    const a = slotA.bytes, b = slotB.bytes;
    const n = Math.min(a.length, b.length);
    let equal = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[i]) equal++;
    const hunks = computeDiffHunks(a, b);
    const firstDiff = hunks.length && !hunks[0].tail ? hunks[0].start : (hunks.length ? hunks[0].start : null);
    setScan({ equal, hunks, firstDiff, windowBytes: Math.max(a.length, b.length) });
    setPage(0);
    setCurHunk(hunks.length ? 0 : -1);
  }, [busy, slotA.bytes, slotB.bytes]);

  /* ---------------- text-mode derived state ---------------- */

  const textA = React.useMemo(() => (dmode === "text" && slotA.bytes && slotA.bytes.length ? buildTextSide(slotA.bytes) : null), [dmode, slotA.bytes]);
  const textB = React.useMemo(() => (dmode === "text" && slotB.bytes && slotB.bytes.length ? buildTextSide(slotB.bytes) : null), [dmode, slotB.bytes]);

  const textDiff = React.useMemo<{ ops: LineOp[]; stats: TextDiffStats; error: string | null } | null>(() => {
    if (!textA || !textB) return null;
    try {
      const ops = diffLines(textA.lines, textB.lines);
      return { ops, stats: textDiffStats(ops), error: null };
    } catch (e) {
      return {
        ops: [],
        stats: { added: 0, removed: 0, changed: 0, equal: 0, hunks: 0 },
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [textA, textB]);

  /* syntax highlighting for text mode: language from A's filename (auto fallback),
     whole-text tokenization into per-line token arrays (capped for performance) */
  React.useEffect(() => {
    if (dmode !== "text" || !textA || !textB || !slotA.file || !slotB.file) { setSyntax(null); return; }
    let cancelled = false;
    (async () => {
      const hljs = await loadHljs();
      if (cancelled || !hljs) { if (!cancelled) setSyntax(null); return; }
      let lang = detectLang(slotA.file!.name, textA.lines[0] ?? "");
      if (!lang) lang = detectLang(slotB.file!.name, textB.lines[0] ?? "");
      if (!lang) lang = autoDetectLang(textA.lines.slice(0, 200).join("\n"), hljs);
      if (!lang) { if (!cancelled) setSyntax({ lang: "", tokA: null, tokB: null, capped: false }); return; }
      const charsA = textA.lines.reduce((s, l) => s + l.length + 1, 0);
      const charsB = textB.lines.reduce((s, l) => s + l.length + 1, 0);
      const capped = charsA > SYNTAX_CHAR_CAP || charsB > SYNTAX_CHAR_CAP
        || textA.lines.length > SYNTAX_LINE_CAP || textB.lines.length > SYNTAX_LINE_CAP;
      if (capped) {
        if (!cancelled) setSyntax({ lang, tokA: null, tokB: null, capped: true });
        return;
      }
      const tokA = tokenizeLines(textA.lines.join("\n"), lang, hljs);
      const tokB = tokenizeLines(textB.lines.join("\n"), lang, hljs);
      if (!cancelled) setSyntax({ lang, tokA, tokB, capped: false });
    })();
    return () => { cancelled = true; };
  }, [dmode, textA, textB, slotA.file, slotB.file]);

  const patch = React.useMemo(() => {
    if (!textDiff || textDiff.error || !textA || !textB || !slotA.file || !slotB.file) return "";
    if (textDiff.stats.added === 0 && textDiff.stats.removed === 0) return "";
    try {
      return buildUnifiedPatch(slotA.file.name, slotB.file.name, textA.lines, textB.lines, textDiff.ops, textA.noNewline, textB.noNewline);
    } catch { return ""; }
  }, [textDiff, textA, textB, slotA.file, slotB.file]);

  /** word-level parts per op index (del → aParts, ins → bParts), for paired change runs */
  const wordMap = React.useMemo<Map<number, WordDiffResult>>(() => {
    const m = new Map<number, WordDiffResult>();
    if (!textDiff || textDiff.error) return m;
    const ops = textDiff.ops;
    let i = 0;
    while (i < ops.length) {
      if (ops[i].type === "equal") { i++; continue; }
      const dels: number[] = [];
      const ins: number[] = [];
      while (i < ops.length && ops[i].type !== "equal") {
        if (ops[i].type === "delete") dels.push(i);
        else ins.push(i);
        i++;
      }
      const pairs = Math.min(dels.length, ins.length);
      for (let k = 0; k < pairs; k++) {
        const d = ops[dels[k]] as Extract<LineOp, { type: "delete" }>;
        const n = ops[ins[k]] as Extract<LineOp, { type: "insert" }>;
        const r = wordDiff(textA?.lines[d.aIdx] ?? "", textB?.lines[n.bIdx] ?? "");
        if (r) { m.set(dels[k], r); m.set(ins[k], r); }
      }
    }
    return m;
  }, [textDiff, textA, textB]);

  /** unified-view segments: change/context runs with collapsible long equal gaps + block ids */
  const unifiedSegs = React.useMemo<USeg[]>(() => {
    if (!textDiff || textDiff.error) return [];
    const ops = textDiff.ops;
    const segs: USeg[] = [];
    const itemsOf = (from: number, to: number): USegItem[] => {
      const out: USegItem[] = [];
      for (let k = from; k < to; k++) out.push({ op: ops[k], i: k });
      return out;
    };
    let i = 0;
    let gapId = 0;
    let blockId = 0;
    while (i < ops.length) {
      if (ops[i].type !== "equal") {
        let j = i;
        while (j < ops.length && ops[j].type !== "equal") j++;
        segs.push({ type: "rows", items: itemsOf(i, j), block: blockId++ });
        i = j;
        continue;
      }
      let j = i;
      while (j < ops.length && ops[j].type === "equal") j++;
      const run = j - i;
      if (run > COLLAPSE_OVER) {
        segs.push({ type: "rows", items: itemsOf(i, i + CTX) });
        segs.push({ type: "gap", from: i + CTX, to: j - CTX, count: run - CTX * 2, id: gapId++ });
        segs.push({ type: "rows", items: itemsOf(j - CTX, j) });
      } else {
        segs.push({ type: "rows", items: itemsOf(i, j) });
      }
      i = j;
    }
    return segs;
  }, [textDiff]);

  const blockCount = React.useMemo(() => {
    if (!textDiff || textDiff.error) return 0;
    let n = 0;
    for (const s of unifiedSegs) if (s.type === "rows" && s.block != null) n++;
    return n;
  }, [textDiff, unifiedSegs]);

  /* jump to a change block: scroll its first row into view (expanding pagination if needed) */
  const goBlock = React.useCallback((idx: number) => {
    if (!blockCount) return;
    const i = (idx + blockCount) % blockCount;
    setCurBlock(i);
    const sel = `[data-block="${i}"]`;
    const scrollTo = () => {
      const el = document.querySelector(sel);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    if (!document.querySelector(sel)) setShownRows((n) => n + ROWS_PER_PAGE);
    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollTo));
  }, [blockCount]);

  /* n / p navigate change blocks while in text mode (not in three-way mode) */
  React.useEffect(() => {
    if (dmode !== "text" || threeway) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      if (e.key === "n") { e.preventDefault(); goBlock(curBlock + 1); }
      else if (e.key === "p") { e.preventDefault(); goBlock(curBlock - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dmode, threeway, curBlock, goBlock]);

  const splitRows = React.useMemo<SRow[]>(() => {
    if (!textDiff || textDiff.error || !textA || !textB) return [];
    const rows: SRow[] = [];
    const ops = textDiff.ops;
    let i = 0;
    let blockId = 0;
    while (i < ops.length) {
      const op = ops[i];
      if (op.type === "equal") {
        rows.push({ kind: "eq", aN: op.aIdx, aText: textA.lines[op.aIdx], bN: op.bIdx, bText: textB.lines[op.bIdx] });
        i++;
        continue;
      }
      const dels: number[] = [];
      const ins: number[] = [];
      while (i < ops.length && ops[i].type !== "equal") {
        if (ops[i].type === "delete") dels.push(i);
        else ins.push(i);
        i++;
      }
      const pairs = Math.min(dels.length, ins.length);
      for (let k = 0; k < pairs; k++) {
        const d = ops[dels[k]] as Extract<LineOp, { type: "delete" }>;
        const n = ops[ins[k]] as Extract<LineOp, { type: "insert" }>;
        const w = wordDiff(textA.lines[d.aIdx], textB.lines[n.bIdx]);
        rows.push({
          kind: "mod",
          aN: d.aIdx, aText: textA.lines[d.aIdx],
          bN: n.bIdx, bText: textB.lines[n.bIdx],
          aParts: w?.aParts, bParts: w?.bParts,
          block: blockId,
        });
      }
      for (let k = pairs; k < dels.length; k++) {
        const d = ops[dels[k]] as Extract<LineOp, { type: "delete" }>;
        rows.push({ kind: "del", aN: d.aIdx, aText: textA.lines[d.aIdx], block: blockId });
      }
      for (let k = pairs; k < ins.length; k++) {
        const n = ops[ins[k]] as Extract<LineOp, { type: "insert" }>;
        rows.push({ kind: "ins", bN: n.bIdx, bText: textB.lines[n.bIdx], block: blockId });
      }
      blockId++;
    }
    return rows;
  }, [textDiff, textA, textB]);

  /* ---------------- byte-mode helpers (unchanged) ---------------- */

  const identical = !!(slotA.hash && slotB.hash && slotA.hash === slotB.hash && slotA.file?.size === slotB.file?.size);
  const windowBytes = scan?.windowBytes ?? 0;
  const diffBytes = scan ? windowBytes - scan.equal : 0;
  const similarity = scan && windowBytes ? (scan.equal / windowBytes) * 100 : identical ? 100 : 0;
  const totalPages = Math.max(1, Math.ceil(windowBytes / PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const base = safePage * PAGE;
  const viewLen = Math.max(0, Math.min(PAGE, windowBytes - base));
  const aBytes = slotA.bytes;
  const bBytes = slotB.bytes;

  function jumpToOffset(off: number) {
    const p = Math.floor(off / PAGE);
    setPage(Math.max(0, Math.min(p, totalPages - 1)));
  }

  function goHunk(idx: number) {
    if (!scan || !scan.hunks.length) return;
    const i = (idx + scan.hunks.length) % scan.hunks.length;
    setCurHunk(i);
    jumpToOffset(scan.hunks[i].start);
  }

  function tryJump() {
    const q = jump.trim();
    setJumpErr("");
    if (!q) return;
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(q)) v = parseInt(q, 16);
    else if (/^\d+$/.test(q)) v = parseInt(q, 10);
    else { setJumpErr("Use decimal or 0x-hex"); return; }
    if (v < 0 || v >= windowBytes) { setJumpErr("Out of range"); return; }
    jumpToOffset(v);
  }

  function swap() {
    const a = slotA, b = slotB;
    setSlotA(b); setSlotB(a);
    setScan(null);
  }

  function copySummary() {
    if (!slotA.file || !slotB.file) return;
    let resultLine: string;
    if (dmode === "text" && textDiff) {
      const s = textDiff.stats;
      resultLine = s.added === 0 && s.removed === 0
        ? "result: textually identical"
        : `result: +${s.added} added · -${s.removed} removed · ~${s.changed} changed · ${s.hunks} hunks · ${s.equal} unchanged lines`;
    } else {
      resultLine = identical ? "result: byte-identical"
        : `result: ${diffBytes} differing bytes · ${similarity.toFixed(2)}% similar · ${scan?.hunks.length ?? 0} hunks · first diff ${scan?.firstDiff != null ? hexOffset(scan.firstDiff) : "—"}`;
    }
    const lines = [
      `A: ${slotA.file.name} (${formatBytes(slotA.file.size)}) sha256=${slotA.hash ?? "…"}`,
      `B: ${slotB.file.name} (${formatBytes(slotB.file.size)}) sha256=${slotB.hash ?? "…"}`,
      resultLine,
    ];
    void navigator.clipboard?.writeText(lines.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function copyPatch() {
    if (!patch) return;
    void navigator.clipboard?.writeText(patch);
    setPatchCopied(true);
    window.setTimeout(() => setPatchCopied(false), 1800);
  }

  function savePatch() {
    if (!patch || !slotA.file || !slotB.file) return;
    const base = (slotA.file.name.replace(/\.[^.]+$/, "") || "diff") + "-vs-" + (slotB.file.name.replace(/\.[^.]+$/, "") || "b");
    const blob = new Blob([patch], { type: "text/x-diff;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.patch`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const slotCard = (side: "A" | "B", slot: SlotState, onFile: (f: File | null) => void, inputRef: React.RefObject<HTMLInputElement | null>) => (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation();
        const f = e.dataTransfer?.files?.[0];
        if (f) { setScan(null); onFile(f); }
      }}
      className="group/slot flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 transition-colors hover:border-emerald-800/70 hover:bg-zinc-900"
      onClick={() => inputRef.current?.click()}
      role="button"
      aria-label={`Choose file for side ${side}`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
    >
      <span className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-bold",
        side === "A"
          ? "border-teal-900/60 bg-teal-950/40 text-teal-300"
          : "border-amber-900/60 bg-amber-950/30 text-amber-300",
      )}>{side}</span>
      <div className="min-w-0 flex-1">
        {slot.file ? (
          <>
            <div className="truncate font-mono text-xs text-zinc-200" title={slot.file.name}>{slot.file.name}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
              <span className="shrink-0">{formatBytes(slot.file.size)}</span>
              {slot.truncated ? <span className="inline-flex shrink-0 items-center gap-1 text-amber-400/90"><AlertTriangle className="h-3 w-3" />window {formatBytes(COMPARE_CAP)}</span> : null}
              {slot.hash ? (
                <span
                  className="inline-flex min-w-0 items-center gap-1 rounded border border-zinc-800 bg-zinc-950/60 px-1.5 py-px"
                  title={`sha256 ${slot.hash} — click to copy`}
                  onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(slot.hash ?? ""); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void navigator.clipboard?.writeText(slot.hash ?? ""); } }}
                >
                  <span className="shrink-0 text-zinc-600">sha256</span>
                  <span className="truncate text-zinc-400">{slot.hash.slice(0, 8)}…{slot.hash.slice(-4)}</span>
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-xs text-zinc-500">
            <span className="text-zinc-300">Click or drop file</span> — side {side}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (f) { setScan(null); onFile(f); }
          e.target.value = "";
        }}
      />
    </div>
  );

  /* ---------------- text render helpers ---------------- */

  /** single syntax token as a span (class targets the scoped .dxhl palette) */
  const tokSpan = (t: LineTok, key: string): React.ReactNode =>
    t.cls ? <span key={key} className={t.cls}>{t.text}</span> : <React.Fragment key={key}>{t.text}</React.Fragment>;

  /**
   * Full line renderer: syntax tokens (when on) merged with word-level changed
   * spans — changed words keep their rose/emerald bg while inheriting token colors,
   * so GitHub-style word diffs read like syntax-highlighted code.
   */
  const renderLineContent = (
    text: string,
    toks: LineTok[] | undefined,
    parts: WordPartView[] | undefined,
    side: "del" | "ins" | "ctx",
  ): React.ReactNode => {
    const useToks = !!(syntaxOn && syntax && toks && toks.length);
    const useParts = !!(wordHl && parts && parts.length);
    if (useParts) {
      const out: React.ReactNode[] = [];
      let off = 0;
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        const start = off;
        const end = off + p.text.length;
        off = end;
        const inner = useToks ? sliceTokens(toks!, start, end) : [{ text: p.text, cls: null }];
        const rendered = inner.map((t, ti) => tokSpan(t, `${pi}-${ti}`));
        if (p.changed) {
          out.push(
            <span
              key={pi}
              className={cn(
                "rounded-[2px]",
                side === "del" ? "bg-rose-800/80 text-rose-100" : "bg-emerald-800/80 text-emerald-100",
              )}
            >{rendered}</span>,
          );
        } else {
          out.push(<React.Fragment key={pi}>{rendered}</React.Fragment>);
        }
      }
      return out;
    }
    if (useToks) return toks!.map((t, i) => tokSpan(t, String(i)));
    return text || " ";
  };

  const renderUnifiedRows = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let shown = 0;
    const keyBase = "u";
    const tokA = syntax?.tokA ?? null;
    const tokB = syntax?.tokB ?? null;
    for (let si = 0; si < unifiedSegs.length; si++) {
      if (shown >= shownRows) break;
      const seg = unifiedSegs[si];
      if (seg.type === "gap") {
        if (expandedGaps.has(seg.id)) {
          const ops = textDiff?.ops.slice(seg.from, seg.to) ?? [];
          for (let k = 0; k < ops.length; k++) {
            if (shown++ >= shownRows) break;
            const op = ops[k];
            if (op.type === "equal") out.push(unifiedRow(keyBase + si + "e" + op.aIdx, "ctx", op.aIdx, op.bIdx, textA?.lines[op.aIdx] ?? "", undefined, undefined, undefined, tokA?.[op.aIdx]));
          }
        } else {
          out.push(
            <button
              key={keyBase + "g" + seg.id}
              type="button"
              onClick={() => setExpandedGaps((prev) => { const n = new Set(prev); n.add(seg.id); return n; })}
              className="group/gap flex w-full items-center gap-3 border-y border-zinc-800/60 bg-zinc-900/40 px-3 py-1 font-mono text-[10px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-emerald-300"
            >
              <ChevronRight className="h-3 w-3 transition-transform group-hover/gap:rotate-90" />
              ⋯ {seg.count.toLocaleString()} unchanged lines — expand
            </button>,
          );
        }
        continue;
      }
      for (const it of seg.items) {
        if (shown >= shownRows) break;
        const op = it.op;
        const w = wordMap.get(it.i);
        if (op.type === "equal") out.push(unifiedRow(keyBase + si + "e" + op.aIdx, "ctx", op.aIdx, op.bIdx, textA?.lines[op.aIdx] ?? "", undefined, undefined, undefined, tokA?.[op.aIdx]));
        else if (op.type === "delete") out.push(unifiedRow(keyBase + si + "d" + op.aIdx, "del", op.aIdx, null, textA?.lines[op.aIdx] ?? "", w?.aParts, "del", seg.block, tokA?.[op.aIdx]));
        else out.push(unifiedRow(keyBase + si + "i" + op.bIdx, "ins", null, op.bIdx, textB?.lines[op.bIdx] ?? "", w?.bParts, "ins", seg.block, tokB?.[op.bIdx]));
        shown++;
      }
    }
    return out;
  };

  const unifiedRow = (
    key: string,
    kind: "ctx" | "del" | "ins",
    aN: number | null,
    bN: number | null,
    text: string,
    parts?: WordPartView[],
    partsSide?: "del" | "ins",
    block?: number,
    toks?: LineTok[],
  ): React.ReactNode => (
    <div
      key={key}
      data-block={block}
      className={cn(
        "group/urow flex items-start gap-0 font-mono text-[11px] leading-5",
        kind === "del" && "bg-rose-950/30",
        kind === "ins" && "bg-emerald-950/30",
        block != null && block === curBlock && "relative shadow-[inset_2px_0_0_0_#f59e0b]",
      )}
    >
      <span className={cn(
        "w-12 shrink-0 select-none border-r pr-2 text-right text-[10px] tabular-nums",
        block != null && block === curBlock ? "border-amber-700/60 text-amber-400" : "border-zinc-800/60 text-zinc-600",
      )}>{aN != null ? aN + 1 : ""}</span>
      <span className={cn(
        "w-12 shrink-0 select-none border-r px-2 text-right text-[10px] tabular-nums",
        block != null && block === curBlock ? "border-amber-700/60 text-amber-400" : "border-zinc-800/60 text-zinc-600",
      )}>{bN != null ? bN + 1 : ""}</span>
      <span className={cn(
        "w-5 shrink-0 select-none text-center",
        kind === "del" ? "text-rose-400" : kind === "ins" ? "text-emerald-400" : "text-zinc-700",
      )}>
        {kind === "del" ? "−" : kind === "ins" ? "+" : " "}
      </span>
      <span className={cn(
        "min-w-0 flex-1 px-2 text-zinc-300",
        kind === "del" && "text-rose-200",
        kind === "ins" && "text-emerald-200",
        wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
      )}>
        {renderLineContent(text || " ", toks, parts, (partsSide ?? (kind === "ctx" ? "ctx" : kind)) as "del" | "ins" | "ctx")}
      </span>
    </div>
  );

  const totalUnifiedRows = React.useMemo(() => {
    let n = 0;
    for (const seg of unifiedSegs) {
      if (seg.type === "gap") { if (expandedGaps.has(seg.id)) n += seg.count; else n += 1; }
      else n += seg.items.length;
    }
    return n;
  }, [unifiedSegs, expandedGaps]);

  const totalSplitRows = splitRows.length;

  /* ---------------- render ---------------- */

  const bothReady = !!(slotA.bytes && slotB.bytes && !busy);
  const textTruncated = !!(textA?.truncatedBytes || textA?.truncatedLines || textB?.truncatedBytes || textB?.truncatedLines);

  /* three-way mode: fully self-contained merge view (own toolbar + slots) */
  if (threeway) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-zinc-950">
        <ThreeWayView
          initialBase={null}
          initialMine={slotA.file}
          initialTheirs={slotB.file}
          onExit={() => setThreeway(false)}
          onClose={onClose}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">Compare</Chip>
            <Segmented
              value={dmode}
              onChange={(v) => { modeTouched.current = true; setDmode(v); }}
              options={[{ value: "bytes", label: "Bytes" }, { value: "text", label: "Text" }]}
            />
            <ToolButton label="Swap A and B" onClick={swap}><ArrowLeftRight className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton
              label="3-way"
              active={threeway}
              onClick={() => setThreeway((v) => !v)}
              title="Three-way merge — base vs two derived versions"
            >
              <GitBranch className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Copy summary" onClick={copySummary}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            {dmode === "text" && patch ? (
              <>
                <ToolButton label="Copy patch" onClick={copyPatch} title="Copy unified diff to clipboard">
                  {patchCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </ToolButton>
                <ToolButton label="Save .patch" onClick={savePatch} title="Download unified diff">
                  <Download className="h-3.5 w-3.5" />
                </ToolButton>
              </>
            ) : null}
          </>
        }
        center={dmode === "text" ? (
          <>
            <Segmented
              value={textView}
              onChange={(v) => setTextView(v)}
              options={[{ value: "unified", label: "Unified" }, { value: "split", label: "Split" }]}
            />
            <ToolButton
              label="Syntax"
              active={syntaxOn}
              onClick={() => setSyntaxOn((v) => !v)}
              title={syntax?.lang ? `Syntax highlighting (${syntax.lang})` : "Syntax highlighting (no language detected)"}
            >
              <Code2 className={cn("h-3.5 w-3.5", !syntax?.lang && "opacity-40")} />
            </ToolButton>
            <ToolButton label="Words" active={wordHl} onClick={() => setWordHl((v) => !v)} title="Word-level highlighting inside changed lines">
              <Highlighter className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Wrap" active={wrap} onClick={() => setWrap((v) => !v)} title="Toggle line wrapping">
              <WrapText className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        ) : undefined}
        right={
          <ToolButton label="Close compare" onClick={onClose}><X className="h-3.5 w-3.5" /></ToolButton>
        }
      />

      {/* slots */}
      <div className="flex shrink-0 items-start gap-2 border-b border-zinc-800/80 bg-zinc-950 p-3">
        {slotCard("A", slotA, (f) => setSlotA((s) => ({ ...emptySlot, file: f })), inputA)}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-4 text-zinc-600">
          <GitCompare className="h-4 w-4" />
        </div>
        {slotCard("B", slotB, (f) => setSlotB((s) => ({ ...emptySlot, file: f })), inputB)}
      </div>

      {/* verdict + stats */}
      {(slotA.file || slotB.file) ? (
        <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-900/30 px-3 py-2">
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
              Reading &amp; hashing…
            </div>
          ) : hashErr ? (
            <ErrorCard title="Hash error" message={hashErr} />
          ) : identical ? (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
              <Equal className="h-4 w-4" />
              Files are byte-identical
              <span className="ml-auto font-mono text-[10px] text-emerald-400/70">sha256 match</span>
            </div>
          ) : dmode === "text" && textDiff ? (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
              {textDiff.stats.added === 0 && textDiff.stats.removed === 0 ? (
                <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300">textually identical (bytes may differ)</span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-2 py-0.5 text-emerald-300 tabular-nums"><Plus className="h-3 w-3" />{textDiff.stats.added.toLocaleString()} added</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-rose-300 tabular-nums"><Minus className="h-3 w-3" />{textDiff.stats.removed.toLocaleString()} removed</span>
                  <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300 tabular-nums">~{textDiff.stats.changed.toLocaleString()} changed</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 tabular-nums">{textDiff.stats.hunks.toLocaleString()} hunks</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 tabular-nums">{textDiff.stats.equal.toLocaleString()} unchanged</span>
                </>
              )}
              {textA && textB && textA.enc !== textB.enc ? (
                <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">A {textA.enc} vs B {textB.enc}</span>
              ) : null}
              {textTruncated ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">
                  <AlertTriangle className="h-3 w-3" />text window: first {formatBytes(TEXT_CAP)} / {LINE_CAP.toLocaleString()} lines per side
                </span>
              ) : null}
              {syntaxOn && syntax?.capped ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">
                  <AlertTriangle className="h-3 w-3" />syntax off — file over {SYNTAX_LINE_CAP.toLocaleString()} lines
                </span>
              ) : null}
            </div>
          ) : scan ? (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 tabular-nums">diff {diffBytes.toLocaleString()} B</span>
              <span className="rounded-full border border-rose-900/60 bg-rose-950/40 px-2 py-0.5 text-rose-300 tabular-nums">{similarity.toFixed(2)}% similar</span>
              <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300 tabular-nums">{scan.hunks.length} hunks</span>
              {scan.firstDiff != null ? (
                <span className="rounded-full border border-rose-900/60 bg-rose-950/30 px-2 py-0.5 text-rose-200 tabular-nums">first {hexOffset(scan.firstDiff)}</span>
              ) : null}
              {(slotA.truncated || slotB.truncated) ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">
                  <AlertTriangle className="h-3 w-3" />compared first {formatBytes(COMPARE_CAP)}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <FileDiff className="h-3.5 w-3.5" />
              {slotA.file && slotB.file ? "Pick both sides to compare" : "Drop a file into each slot"}
            </div>
          )}
        </div>
      ) : null}

      {/* text change-block navigator */}
      {dmode === "text" && blockCount > 0 && textDiff && !textDiff.error && textDiff.stats.added + textDiff.stats.removed > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5">
          <ToolButton label="Previous change" onClick={() => goBlock(curBlock - 1)} title="Previous change block (p)"><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
            change {blockCount ? `${Math.min(curBlock, blockCount - 1) + 1} / ${blockCount}` : "0 / 0"}
          </span>
          <ToolButton label="Next change" onClick={() => goBlock(curBlock + 1)} title="Next change block (n)"><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-mono text-[9px] text-zinc-500 sm:inline-flex">
            <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1">n</kbd>/<kbd className="rounded border border-zinc-700 bg-zinc-900 px-1">p</kbd>
            to navigate
          </span>
        </div>
      ) : null}

      {/* byte hunk navigator */}
      {dmode === "bytes" && scan && scan.hunks.length > 0 && !identical ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-3 py-1.5">
          <ToolButton label="Previous difference" onClick={() => goHunk(curHunk - 1)}><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
          <span className="shrink-0 font-mono text-[10px] text-zinc-500 tabular-nums">
            {scan.hunks.length ? `${curHunk + 1} / ${scan.hunks.length}` : "0 / 0"}
          </span>
          <ToolButton label="Next difference" onClick={() => goHunk(curHunk + 1)}><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto scrollbar-thin py-0.5">
            {scan.hunks.slice(0, 400).map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setCurHunk(i); jumpToOffset(h.start); }}
                title={`${hexOffset(h.start)} · ${h.end - h.start} B${h.tail ? " · tail" : ""}`}
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] tabular-nums transition-colors",
                  i === curHunk
                    ? "border-rose-700 bg-rose-900/40 text-rose-200"
                    : h.tail
                      ? "border-amber-900/60 bg-amber-950/30 text-amber-300/80 hover:border-amber-700"
                      : "border-rose-900/50 bg-rose-950/20 text-rose-300/70 hover:border-rose-700",
                )}
              >
                {h.tail ? "+" : ""}{h.start.toString(16).toUpperCase()}
              </button>
            ))}
            {scan.hunks.length > 400 ? <span className="shrink-0 self-center font-mono text-[9px] text-zinc-600">+{(scan.hunks.length - 400).toLocaleString()} more</span> : null}
          </div>
        </div>
      ) : null}

      {/* main pane */}
      {dmode === "text" ? (
        <div className="relative min-h-0 flex-1 overflow-auto bg-zinc-950 scrollbar-thin">
          {!bothReady || !textA || !textB ? (
            slotA.file || slotB.file ? (
              <LoadingState label="Reading files…" />
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div className="max-w-sm">
                  <FileDiff className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
                  <div className="text-sm font-medium text-zinc-300">Text compare</div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    Load two text files — Omniscope aligns them line-by-line (patience + LCS diff),
                    fully client-side. Export a standard .patch when done.
                  </p>
                </div>
              </div>
            )
          ) : textDiff?.error ? (
            <div className="p-4"><ErrorCard title="Diff failed" message={textDiff.error} hint="Try Bytes mode for binary files." /></div>
          ) : textDiff && textDiff.stats.added === 0 && textDiff.stats.removed === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
                <Equal className="h-4 w-4" />
                Textually identical — {textDiff.stats.equal.toLocaleString()} matching lines
              </div>
            </div>
          ) : textView === "unified" ? (
            <div className="min-w-0 dxhl">
              <style>{HL_PALETTE_CSS}</style>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-1 backdrop-blur">
                <Rows3 className="h-3 w-3 text-zinc-600" />
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">unified · 3-line context · collapsible gaps{syntaxOn && syntax?.lang ? ` · ${syntax.lang}` : ""}</span>
              </div>
              {renderUnifiedRows()}
              {totalUnifiedRows <= shownRows && textA && textB ? (
                <div className="mt-1 flex items-center justify-center gap-2 border-t border-zinc-800/60 py-2 font-mono text-[10px] text-zinc-700">
                  <span className="h-px w-16 bg-zinc-800" aria-hidden />
                  EOF — A {textA.lines.length.toLocaleString()} · B {textB.lines.length.toLocaleString()} lines
                  <span className="h-px w-16 bg-zinc-800" aria-hidden />
                </div>
              ) : null}
              {totalUnifiedRows > shownRows ? (
                <button
                  type="button"
                  onClick={() => setShownRows((n) => n + ROWS_PER_PAGE)}
                  className="my-2 mx-auto flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-700 hover:text-emerald-300"
                >
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                  Show more rows ({(totalUnifiedRows - shownRows).toLocaleString()} hidden)
                </button>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0 dxhl">
              <style>{HL_PALETTE_CSS}</style>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-1 backdrop-blur">
                <Columns2 className="h-3 w-3 text-zinc-600" />
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">split · aligned sides · paired changes{syntaxOn && syntax?.lang ? ` · ${syntax.lang}` : ""}</span>
              </div>
              {splitRows.slice(0, shownRows).map((r, i) => {
                const aToks = syntax?.tokA?.[r.aN ?? -1];
                const bToks = syntax?.tokB?.[r.bN ?? -1];
                return (
                <div
                  key={i}
                  data-block={r.block}
                  className={cn(
                    "flex items-start font-mono text-[11px] leading-5",
                    r.block != null && r.block === curBlock && "relative shadow-[inset_2px_0_0_0_#f59e0b]",
                  )}
                >
                  <div className={cn(
                    "flex min-w-0 flex-1 items-start",
                    (r.kind === "del" || r.kind === "mod") && "bg-rose-950/30",
                    r.kind === "eq" && "hover:bg-zinc-900/50",
                  )}>
                    <span className={cn(
                      "w-12 shrink-0 select-none border-r pr-2 text-right text-[10px] tabular-nums",
                      r.block != null && r.block === curBlock ? "border-amber-700/60 text-amber-400" : "border-zinc-800/60 text-zinc-600",
                    )}>{r.aN != null ? r.aN + 1 : ""}</span>
                    <span className={cn(
                      "min-w-0 flex-1 px-2",
                      r.kind === "del" ? "text-rose-200" : r.kind === "mod" ? "text-rose-200" : "text-zinc-300",
                      wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                    )}>
                      {renderLineContent(r.aText || " ", aToks, r.aParts, "del")}
                    </span>
                  </div>
                  <div className={cn(
                    "flex min-w-0 flex-1 items-start border-l border-zinc-800",
                    (r.kind === "ins" || r.kind === "mod") && "bg-emerald-950/30",
                    r.kind === "eq" && "hover:bg-zinc-900/50",
                  )}>
                    <span className={cn(
                      "w-12 shrink-0 select-none border-r pr-2 text-right text-[10px] tabular-nums",
                      r.block != null && r.block === curBlock ? "border-amber-700/60 text-amber-400" : "border-zinc-800/60 text-zinc-600",
                    )}>{r.bN != null ? r.bN + 1 : ""}</span>
                    <span className={cn(
                      "min-w-0 flex-1 px-2",
                      r.kind === "ins" ? "text-emerald-200" : r.kind === "mod" ? "text-emerald-200" : "text-zinc-300",
                      wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
                    )}>
                      {renderLineContent(r.bText || " ", bToks, r.bParts, "ins")}
                    </span>
                  </div>
                </div>
                );
              })}
              {totalSplitRows <= shownRows && textA && textB ? (
                <div className="flex items-stretch border-t border-zinc-800/60 font-mono text-[10px]">
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2 py-2 text-zinc-700">
                    <span className="h-px flex-1 max-w-16 bg-zinc-800" aria-hidden />
                    EOF · {textA.lines.length.toLocaleString()} lines
                    <span className="h-px flex-1 max-w-16 bg-zinc-800" aria-hidden />
                  </div>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-2 border-l border-zinc-800 py-2 text-zinc-700">
                    <span className="h-px flex-1 max-w-16 bg-zinc-800" aria-hidden />
                    EOF · {textB.lines.length.toLocaleString()} lines
                    <span className="h-px flex-1 max-w-16 bg-zinc-800" aria-hidden />
                  </div>
                </div>
              ) : null}
              {totalSplitRows > shownRows ? (
                <button
                  type="button"
                  onClick={() => setShownRows((n) => n + ROWS_PER_PAGE)}
                  className="my-2 mx-auto flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-700 hover:text-emerald-300"
                >
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                  Show more rows ({(totalSplitRows - shownRows).toLocaleString()} hidden)
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        /* hex table */
        <div className="relative min-h-0 flex-1 overflow-auto bg-zinc-950 p-3 scrollbar-thin">
          {busy || (!aBytes && !bBytes) ? (
            slotA.file || slotB.file ? (
              <LoadingState label="Reading files…" />
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div className="max-w-sm">
                  <GitCompare className="mx-auto mb-3 h-10 w-10 text-zinc-700" />
                  <div className="text-sm font-medium text-zinc-300">Binary compare</div>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    Load two files — Omniscope hashes and diffs them byte-by-byte, fully client-side.
                    Differing bytes are highlighted, with hunk navigation and jump-to-offset.
                    Text files auto-switch to the <span className="text-emerald-300">Text</span> mode.
                  </p>
                </div>
              </div>
            )
          ) : aBytes && bBytes ? (
            <table className="w-full border-separate border-spacing-0 font-mono text-[11px] leading-5">
              <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
                <tr className="text-[9px] uppercase tracking-wider text-zinc-600">
                  <th className="border-b border-zinc-800 px-2 py-1 text-left font-medium">Offset</th>
                  <th className="border-b border-zinc-800 px-2 py-1 text-left font-medium text-teal-400/70">A hex</th>
                  <th className="border-b border-zinc-800 px-2 py-1 text-left font-medium text-amber-400/70">B hex</th>
                  <th className="border-b border-zinc-800 px-2 py-1 text-left font-medium text-teal-400/50">A ascii</th>
                  <th className="border-b border-zinc-800 px-2 py-1 text-left font-medium text-amber-400/50">B ascii</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.ceil(viewLen / ROW) }, (_, r) => {
                  const rowOff = base + r * ROW;
                  const cells = Array.from({ length: ROW }, (_, c) => {
                    const off = rowOff + c;
                    const av = off < aBytes.length ? aBytes[off] : null;
                    const bv = off < bBytes.length ? bBytes[off] : null;
                    const pastA = off >= aBytes.length;
                    const pastB = off >= bBytes.length;
                    const diff = av !== bv;
                    return { off, av, bv, pastA, pastB, diff };
                  });
                  return (
                    <tr key={r} className="group/row">
                      <td className="whitespace-nowrap border-b border-zinc-900 px-2 py-0.5 text-zinc-600 tabular-nums">{rowOff.toString(16).padStart(8, "0")}</td>
                      {(["a", "b"] as const).map((side) => (
                        <td key={side} className="whitespace-nowrap border-b border-zinc-900 px-2 py-0.5">
                          {cells.map((c) => {
                            const v = side === "a" ? c.av : c.bv;
                            const past = side === "a" ? c.pastA : c.pastB;
                            return (
                              <span
                                key={side + c.off}
                                title={c.diff && !past ? `${hexOffset(c.off)}: ${toHexByte(side === "a" ? (c.av ?? 0) : (c.bv ?? 0))} → ${toHexByte(side === "a" ? (c.bv ?? 0) : (c.av ?? 0))}` : undefined}
                                className={cn(
                                  "inline-block w-[2ch] rounded text-center",
                                  past
                                    ? "bg-amber-950/40 text-amber-500/40"
                                    : c.diff
                                      ? "bg-rose-950/60 text-rose-300"
                                      : "text-zinc-500 group-hover/row:text-zinc-300",
                                )}
                              >
                                {past ? "··" : toHexByte(v ?? 0)}
                              </span>
                            );
                          })}
                        </td>
                      ))}
                      {(["a", "b"] as const).map((side) => (
                        <td key={side + "ascii"} className="whitespace-nowrap border-b border-zinc-900 px-2 py-0.5">
                          {cells.map((c) => {
                            const v = side === "a" ? c.av : c.bv;
                            const past = side === "a" ? c.pastA : c.pastB;
                            const ch = v != null && v >= 32 && v < 127 ? String.fromCharCode(v) : "·";
                            return (
                              <span
                                key={side + "asc" + c.off}
                                className={cn(
                                  "inline-block w-[1ch] text-center",
                                  past
                                    ? "text-amber-500/30"
                                    : c.diff
                                      ? "rounded-sm bg-rose-950/50 text-rose-300"
                                      : "text-zinc-500 group-hover/row:text-zinc-300",
                                )}
                              >
                                {past ? "·" : ch}
                              </span>
                            );
                          })}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <LoadingState label="Reading files…" />
          )}
        </div>
      )}

      {/* byte pagination footer */}
      {dmode === "bytes" && windowBytes > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/80 bg-zinc-900/30 px-3 py-1.5">
          <ToolButton label="Previous page" onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
          <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
            page {safePage + 1}/{totalPages} · {hexOffset(base)}–{hexOffset(base + viewLen)}
          </span>
          <ToolButton label="Next page" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              value={jump}
              onChange={(e) => { setJump(e.target.value); setJumpErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") tryJump(); }}
              placeholder="offset e.g. 0x4f2a1"
              className="h-7 w-36 rounded-md border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-700 focus:outline-none"
              aria-label="Jump to offset"
            />
            <button
              type="button"
              onClick={tryJump}
              className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[10px] font-medium text-zinc-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              Go
            </button>
            {jumpErr ? <span className="font-mono text-[9px] text-rose-400">{jumpErr}</span> : null}
          </div>
        </div>
      ) : null}

      {/* text footer */}
      {dmode === "text" && textA && textB ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/80 bg-zinc-900/30 px-3 py-1.5">
          <FileDiff className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
          <span className="truncate font-mono text-[10px] text-zinc-500">
            A {textA.lines.length.toLocaleString()} lines · {textA.enc} — B {textB.lines.length.toLocaleString()} lines · {textB.enc}
          </span>
          {patch ? (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-400/70">patch ready ({patch.length.toLocaleString()} chars)</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default DiffView;
