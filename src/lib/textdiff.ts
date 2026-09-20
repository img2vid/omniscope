/**
 * textdiff.ts — pure client-side line-diff engine for the Compare view.
 *
 * Hybrid algorithm:
 *  - common prefix/suffix trimming
 *  - patience-style anchoring on lines unique in both ranges (LIS over anchor pairs)
 *  - classic DP LCS for small regions (<= 300×300 cells) and for regions without anchors
 *    (bounded by DP_CAP)
 *  - wholesale replace fallback for pathological large regions
 *
 * Everything is dependency-free and synchronous; inputs are capped by callers.
 */

export type LineOp =
  | { type: "equal"; aIdx: number; bIdx: number }
  | { type: "delete"; aIdx: number }
  | { type: "insert"; bIdx: number };

/* ------------------------------ splitting / decoding ------------------------------ */

/** Split text into lines accepting CRLF, CR and LF; keeps no terminators. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export interface DecodedText {
  text: string;
  enc: "utf-8" | "windows-1252";
  hadBom: boolean;
}

/** Decode bytes preferring UTF-8; fall back to windows-1252 when too many replacements. */
export function decodeTextual(bytes: Uint8Array): DecodedText {
  const hadBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let utf8 = "";
  try {
    utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    utf8 = "";
  }
  let bad = 0;
  for (let i = 0; i < utf8.length; i++) if (utf8.charCodeAt(i) === 0xfffd) bad++;
  if (bad > 0 && bad / Math.max(1, utf8.length) > 0.005) {
    try {
      return { text: new TextDecoder("windows-1252").decode(bytes), enc: "windows-1252", hadBom };
    } catch {
      /* fall through */
    }
  }
  return { text: utf8, enc: "utf-8", hadBom };
}

/** Heuristic: does this look like human-readable text (for auto mode selection)? */
export function looksTextual(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 65536);
  if (n === 0) return false;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0x80) ok++;
  }
  return ok / n >= 0.9;
}

/* ------------------------------ DP LCS ------------------------------ */

const DP_REGION_CELLS = 300 * 300; // small regions always get exact LCS
const DP_CAP = 4_000_000; // absolute DP ceiling (~16 MB Uint32Array)

function lcsOps(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number): LineOp[] {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    const ai = a[aLo + i - 1];
    const row = i * w;
    const prev = (i - 1) * w;
    for (let j = 1; j <= m; j++) {
      dp[row + j] = ai === b[bLo + j - 1]
        ? dp[prev + (j - 1)] + 1
        : Math.max(dp[prev + j], dp[row + (j - 1)]);
    }
  }
  const ops: LineOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[aLo + i - 1] === b[bLo + j - 1]) {
      ops.push({ type: "equal", aIdx: aLo + i - 1, bIdx: bLo + j - 1 });
      i--;
      j--;
    } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
      ops.push({ type: "delete", aIdx: aLo + i - 1 });
      i--;
    } else {
      ops.push({ type: "insert", bIdx: bLo + j - 1 });
      j--;
    }
  }
  while (i > 0) { ops.push({ type: "delete", aIdx: aLo + i - 1 }); i--; }
  while (j > 0) { ops.push({ type: "insert", bIdx: bLo + j - 1 }); j--; }
  ops.reverse();
  return ops;
}

/* ------------------------------ LIS (patience anchors) ------------------------------ */

function lisAnchors(pairs: { ai: number; bi: number }[]): { ai: number; bi: number }[] {
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    const bi = pairs[k].bi;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]].bi < bi) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[k] = tails[lo - 1];
    if (lo === tails.length) tails.push(k);
    else tails[lo] = k;
  }
  const out: { ai: number; bi: number }[] = [];
  let cur = tails.length ? tails[tails.length - 1] : -1;
  while (cur !== -1) { out.push(pairs[cur]); cur = prev[cur]; }
  out.reverse();
  return out;
}

/* ------------------------------ patience recursion ------------------------------ */

const MAX_DEPTH = 48;

function patience(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number, depth: number): LineOp[] {
  const head: LineOp[] = [];
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    head.push({ type: "equal", aIdx: aLo, bIdx: bLo });
    aLo++;
    bLo++;
  }
  const tail: LineOp[] = [];
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    tail.unshift({ type: "equal", aIdx: aHi - 1, bIdx: bHi - 1 });
    aHi--;
    bHi--;
  }
  const n = aHi - aLo;
  const m = bHi - bLo;
  if (n === 0 && m === 0) return head.concat(tail);
  const wholesale = (): LineOp[] => {
    const mid: LineOp[] = [];
    for (let i = aLo; i < aHi; i++) mid.push({ type: "delete", aIdx: i });
    for (let j = bLo; j < bHi; j++) mid.push({ type: "insert", bIdx: j });
    return head.concat(mid, tail);
  };
  if (n === 0 || m === 0) return wholesale();
  const cells = n * m;
  if (cells <= DP_REGION_CELLS || (depth >= MAX_DEPTH && cells <= DP_CAP)) {
    return head.concat(lcsOps(a, b, aLo, aHi, bLo, bHi), tail);
  }
  if (depth >= MAX_DEPTH) return wholesale();
  // patience anchors: lines unique in both remaining ranges
  const countA = new Map<string, number>();
  for (let i = aLo; i < aHi; i++) countA.set(a[i], (countA.get(a[i]) ?? 0) + 1);
  const countB = new Map<string, number>();
  for (let j = bLo; j < bHi; j++) countB.set(b[j], (countB.get(b[j]) ?? 0) + 1);
  const bIndexOfUnique = new Map<string, number>();
  for (let j = bLo; j < bHi; j++) {
    const s = b[j];
    if ((countA.get(s) ?? 0) === 1 && (countB.get(s) ?? 0) === 1) bIndexOfUnique.set(s, j);
  }
  const pairs: { ai: number; bi: number }[] = [];
  for (let i = aLo; i < aHi; i++) {
    const bj = bIndexOfUnique.get(a[i]);
    if (bj !== undefined) pairs.push({ ai: i, bi: bj });
  }
  if (pairs.length === 0) {
    if (cells <= DP_CAP) return head.concat(lcsOps(a, b, aLo, aHi, bLo, bHi), tail);
    return wholesale();
  }
  const anchors = lisAnchors(pairs);
  const out = head;
  let pa = aLo;
  let pb = bLo;
  for (const an of anchors) {
    if (an.ai > pa || an.bi > pb) {
      for (const op of patience(a, b, pa, an.ai, pb, an.bi, depth + 1)) out.push(op);
    }
    out.push({ type: "equal", aIdx: an.ai, bIdx: an.bi });
    pa = an.ai + 1;
    pb = an.bi + 1;
  }
  if (pa < aHi || pb < bHi) {
    for (const op of patience(a, b, pa, aHi, pb, bHi, depth + 1)) out.push(op);
  }
  return out.concat(tail);
}

/** Line diff of two string arrays → ordered op list. */
export function diffLines(a: string[], b: string[]): LineOp[] {
  if (a.length === 0 && b.length === 0) return [];
  return normalizeOps(patience(a, b, 0, a.length, 0, b.length, 0));
}

/** Display normalization: inside each change run, emit deletes before inserts (git style). */
function normalizeOps(ops: LineOp[]): LineOp[] {
  const out: LineOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") { out.push(ops[i]); i++; continue; }
    let end = i;
    while (end < ops.length && ops[end].type !== "equal") end++;
    // stable partition of ops[i..end): deletes first, then inserts
    for (let k = i; k < end; k++) if (ops[k].type === "delete") out.push(ops[k]);
    for (let k = i; k < end; k++) if (ops[k].type === "insert") out.push(ops[k]);
    i = end;
  }
  return out;
}

/* ------------------------------ word-level diff ------------------------------ */

export interface WordPart {
  text: string;
  changed: boolean;
}

export interface WordDiffResult {
  aParts: WordPart[];
  bParts: WordPart[];
}

const TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;
const WORD_DIFF_CAP = 2000; // max chars per side for intra-line highlighting

/**
 * Token-level diff of two paired lines (GitHub-style word highlighting).
 * Returns null when lines are identical, too long, or tokenize to nothing.
 */
export function wordDiff(a: string, b: string): WordDiffResult | null {
  if (a === b) return null;
  if (a.length > WORD_DIFF_CAP || b.length > WORD_DIFF_CAP) return null;
  const tokensA = a.match(TOKEN_RE) ?? [];
  const tokensB = b.match(TOKEN_RE) ?? [];
  if (tokensA.length === 0 && tokensB.length === 0) return null;
  const ops = patience(tokensA, tokensB, 0, tokensA.length, 0, tokensB.length, 0);
  const aParts: WordPart[] = [];
  const bParts: WordPart[] = [];
  const push = (parts: WordPart[], t: string, ch: boolean) => {
    const last = parts[parts.length - 1];
    if (last && last.changed === ch) last.text += t;
    else parts.push({ text: t, changed: ch });
  };
  for (const op of ops) {
    if (op.type === "equal") { push(aParts, tokensA[op.aIdx], false); push(bParts, tokensB[op.bIdx], false); }
    else if (op.type === "delete") push(aParts, tokensA[op.aIdx], true);
    else push(bParts, tokensB[op.bIdx], true);
  }
  return { aParts, bParts };
}

/* ------------------------------ stats ------------------------------ */

export interface TextDiffStats {
  added: number;
  removed: number;
  changed: number; // min(dels, ins) inside adjacent del/ins runs
  equal: number;
  hunks: number;   // adjacent del+ins runs count as one hunk
}

export function textDiffStats(ops: LineOp[]): TextDiffStats {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let equal = 0;
  let hunks = 0;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") { equal++; i++; continue; }
    let dels = 0;
    let ins = 0;
    while (i < ops.length && ops[i].type !== "equal") {
      if (ops[i].type === "delete") dels++;
      else ins++;
      i++;
    }
    added += ins;
    removed += dels;
    changed += Math.min(dels, ins);
    hunks++;
  }
  return { added, removed, changed, equal, hunks };
}

/* ------------------------------ unified patch ------------------------------ */

/**
 * Build a standard unified-diff patch (3 context lines, git-style headers).
 * `aNoNewline`/`bNoNewline` flag the classic "\ No newline at end of file" markers.
 */
export function buildUnifiedPatch(
  nameA: string,
  nameB: string,
  aLines: string[],
  bLines: string[],
  ops: LineOp[],
  aNoNewline = false,
  bNoNewline = false,
): string {
  const out: string[] = [];
  out.push(`--- a/${nameA}`);
  out.push(`+++ b/${nameB}`);
  // rows: index into ops with leading context
  const CTX = 3;
  const GAP = CTX * 2; // equal run longer than this separates hunks
  type Row = { op: LineOp };
  const rows: Row[] = ops.map((op) => ({ op }));
  // find change clusters
  const hunks: { start: number; end: number }[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].op.type === "equal") { i++; continue; }
    // cluster start
    let start = i;
    let lastChange = i;
    let j = i;
    let run = 0;
    while (j < rows.length) {
      if (rows[j].op.type === "equal") {
        run++;
        if (run > GAP && j > lastChange) break;
      } else {
        run = 0;
        lastChange = j;
      }
      j++;
    }
    hunks.push({ start: Math.max(0, start - CTX), end: Math.min(rows.length, lastChange + CTX + 1) });
    i = lastChange + 1 + GAP + 1;
    if (i >= rows.length) break;
    // skip forward to next non-equal
    while (i < rows.length && rows[i].op.type === "equal") i++;
  }
  if (!hunks.length) return "";
  for (const h of hunks) {
    // compute hunk header numbers
    let aStart = -1;
    let bStart = -1;
    let aCount = 0;
    let bCount = 0;
    for (let k = h.start; k < h.end; k++) {
      const op = rows[k].op;
      if (op.type === "equal") { if (aStart < 0) aStart = op.aIdx; if (bStart < 0) bStart = op.bIdx; aCount++; bCount++; }
      else if (op.type === "delete") { if (aStart < 0) aStart = op.aIdx; aCount++; }
      else { if (bStart < 0) bStart = op.bIdx; bCount++; }
    }
    const ah = aCount === 0 ? `${aStart}` : `${aStart + 1},${aCount}`;
    const bh = bCount === 0 ? `${bStart}` : `${bStart + 1},${bCount}`;
    out.push(`@@ -${ah} +${bh} @@`);
    for (let k = h.start; k < h.end; k++) {
      const op = rows[k].op;
      if (op.type === "equal") {
        out.push(" " + aLines[op.aIdx]);
        if (aNoNewline === true && op.aIdx === aLines.length - 1) out.push("\\ No newline at end of file");
      } else if (op.type === "delete") {
        out.push("-" + aLines[op.aIdx]);
        if (aNoNewline === true && op.aIdx === aLines.length - 1) out.push("\\ No newline at end of file");
      } else {
        out.push("+" + bLines[op.bIdx]);
        if (bNoNewline === true && op.bIdx === bLines.length - 1) out.push("\\ No newline at end of file");
      }
    }
  }
  return out.join("\n") + "\n";
}
