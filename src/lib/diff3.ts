/**
 * Three-way (diff3-style) merge analysis for Omniscope.
 *
 * Given a shared BASE line array plus two derived versions (MINE, THEIRS),
 * computes per-region states — unchanged, changed on one side only, changed
 * identically on both sides, or CONFLICT (both changed differently) — plus
 * the auto-merged result with classic conflict markers.
 *
 * Built on the two-way patience diff in textdiff.ts: each side is diffed
 * against BASE, change runs are lifted into events over base ranges, then
 * events from both sides are clustered and classified:
 *   - two spanning events overlap (s1 < e2 && s2 < e1)  → contested region
 *   - a zero-width insert at q is contested by another side's [s,e) when
 *     s < q < e (insert strictly inside the changed region); edge inserts
 *     (q <= s or q >= e) stay independent and ordered
 *   - two zero-width inserts at the same anchor → contested
 * Each contested cluster is rendered by comparing the two sides' full
 * versions of the region (identical → resolved; different → conflict).
 */

import { diffLines, type LineOp } from "./textdiff";

/** one side's change over a base range: base[bStart..bEnd) → `lines` (empty = deletion, bStart===bEnd = pure insert) */
interface Ev {
  bStart: number;
  bEnd: number;
  lines: string[];
  side: "mine" | "theirs";
}

export type Row3Kind = "same" | "mine" | "theirs" | "both" | "conflict";

export interface Row3 {
  kind: Row3Kind;
  /** 0-based line numbers; null when that column has no line on this row */
  baseN: number | null;
  mineN: number | null;
  theirsN: number | null;
  baseText?: string;
  mineText?: string;
  theirsText?: string;
  /** conflict-block id (consecutive rows share one), for navigation */
  conflict?: number;
}

export interface Diff3Stats {
  same: number;
  mineOnly: number;
  theirsOnly: number;
  bothSame: number;
  conflicts: number;
  conflictLines: number;
  mineDel: number;
  theirsDel: number;
}

export interface Diff3Result {
  rows: Row3[];
  stats: Diff3Stats;
  merged: string[];
  /** true when every region resolved without conflict */
  clean: boolean;
}

/** lift a two-way op stream (base → side) into non-overlapping replacement events */
function toEvents(ops: LineOp[], sideLines: string[], baseLen: number, side: "mine" | "theirs"): Ev[] {
  const evs: Ev[] = [];
  let runDel: number[] = []; // deleted base indices
  let runIns: number[] = []; // inserted side indices
  let open = false;

  const flush = (nextBaseIdx: number | null) => {
    if (!open) return;
    open = false;
    const lines = runIns.map((i) => sideLines[i] ?? "");
    let bStart: number, bEnd: number;
    if (runDel.length) {
      bStart = runDel[0];
      bEnd = runDel[runDel.length - 1] + 1;
    } else {
      // pure insert: anchored at the base position of the next equal op (or EOF)
      const pos = nextBaseIdx == null ? baseLen : nextBaseIdx;
      bStart = pos;
      bEnd = pos;
    }
    // merge with a previous event at the exact same anchor (stacked pure inserts)
    const prev = evs[evs.length - 1];
    if (prev && prev.bStart === bStart && prev.bEnd === bEnd) {
      prev.lines.push(...lines);
    } else {
      evs.push({ bStart, bEnd, lines, side });
    }
    runDel = [];
    runIns = [];
  };

  for (const op of ops) {
    if (op.type === "equal") {
      flush(op.aIdx);
    } else if (op.type === "delete") {
      if (!open) { open = true; runDel = []; runIns = []; }
      runDel.push(op.aIdx);
    } else {
      if (!open) { open = true; runDel = []; runIns = []; }
      runIns.push(op.bIdx);
    }
  }
  flush(null);
  return evs;
}

function eqArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const ZERO = (e: Ev) => e.bStart === e.bEnd;

/**
 * Compute the three-way analysis. All inputs are line arrays
 * (use splitLines on decoded text).
 */
export function diff3(base: string[], mine: string[], theirs: string[]): Diff3Result {
  const evMine = toEvents(diffLines(base, mine), mine, base.length, "mine");
  const evTheirs = toEvents(diffLines(base, theirs), theirs, base.length, "theirs");

  /* single merged, ordered stream: by anchor, inserts before spans, mine first on ties */
  const events = [...evMine, ...evTheirs].sort((a, b) =>
    a.bStart - b.bStart || (ZERO(a) ? -1 : 1) - (ZERO(b) ? -1 : 1) || (a.side === "mine" ? -1 : 1),
  );

  const rows: Row3[] = [];
  const stats: Diff3Stats = { same: 0, mineOnly: 0, theirsOnly: 0, bothSame: 0, conflicts: 0, conflictLines: 0, mineDel: 0, theirsDel: 0 };
  const merged: string[] = [];

  let mN = 0, tN = 0; // consumed line counters per side (displayed or not)
  let conflictId = 0;

  /** a side's full text for the region [start, end): inserts + replacements + kept base lines, in order */
  function sideVersion(side: "mine" | "theirs", cluster: Ev[], start: number, end: number): string[] {
    const out: string[] = [];
    let idx = start;
    for (const ev of cluster) {
      if (ev.side !== side) continue;
      if (idx < ev.bStart) out.push(...base.slice(idx, ev.bStart));
      out.push(...ev.lines);
      idx = Math.max(idx, ev.bEnd);
    }
    if (idx < end) out.push(...base.slice(idx, end));
    return out;
  }

  /** emit rows + merged for a cluster where both sides contested (versions differ → conflict) */
  function emitConflict(cluster: Ev[], start: number, end: number) {
    const id = conflictId++;
    stats.conflicts++;
    const mineVer = sideVersion("mine", cluster, start, end);
    const theirsVer = sideVersion("theirs", cluster, start, end);
    // contested original (dimmed, above the two versions)
    for (let k = start; k < end; k++) {
      stats.conflictLines++;
      rows.push({ kind: "conflict", conflict: id, baseN: k, mineN: null, theirsN: null, baseText: base[k] });
    }
    const n = Math.max(mineVer.length, theirsVer.length);
    for (let k = 0; k < n; k++) {
      const hasM = k < mineVer.length;
      const hasT = k < theirsVer.length;
      stats.conflictLines++;
      rows.push({
        kind: "conflict",
        conflict: id,
        baseN: null,
        mineN: hasM ? mN + k : null,
        theirsN: hasT ? tN + k : null,
        mineText: hasM ? mineVer[k] : undefined,
        theirsText: hasT ? theirsVer[k] : undefined,
      });
    }
    mN += mineVer.length;
    tN += theirsVer.length;
    merged.push("<<<<<<< mine");
    merged.push(...mineVer);
    merged.push("=======");
    merged.push(...theirsVer);
    merged.push(">>>>>>> theirs");
  }

  /** emit rows + merged for a cluster whose two sides ended up identical — the whole region is one "both" replacement */
  function emitIdentical(cluster: Ev[], start: number, end: number) {
    const ver = sideVersion("mine", cluster, start, end); // === theirsVer
    const baseCount = end - start;
    const n = Math.max(baseCount, ver.length);
    for (let k = 0; k < n; k++) {
      const hasBase = k < baseCount;
      const hasV = k < ver.length;
      rows.push({
        kind: "both",
        baseN: hasBase ? start + k : null,
        mineN: hasV ? mN + k : null,
        theirsN: hasV ? tN + k : null,
        baseText: hasBase ? base[start + k] : undefined,
        mineText: hasV ? ver[k] : undefined,
        theirsText: hasV ? ver[k] : undefined,
      });
    }
    stats.bothSame += ver.length;
    mN += ver.length;
    tN += ver.length;
    merged.push(...ver);
  }

  /** emit rows + merged for an independent (non-contested) cluster — per-event, in stream order */
  function emitResolved(cluster: Ev[], start: number, end: number) {
    // per-side running offsets for row numbering; the OTHER side's counter also
    // advances over base lines it kept (they exist in its file even when not shown)
    let mOff = 0, tOff = 0;
    let idx = start;
    for (const ev of cluster) {
      // base lines kept by everyone between events → "same" rows
      if (idx < ev.bStart) {
        for (let k = idx; k < ev.bStart; k++) {
          rows.push({ kind: "same", baseN: k, mineN: mN + mOff, theirsN: tN + tOff, baseText: base[k], mineText: base[k], theirsText: base[k] });
          stats.same++;
          merged.push(base[k]);
          mOff++; tOff++;
        }
        idx = ev.bStart;
      }
      if (ZERO(ev)) {
        // pure insert (goes before base line `ev.bStart`)
        for (let k = 0; k < ev.lines.length; k++) {
          rows.push({
            kind: ev.side,
            baseN: null,
            mineN: ev.side === "mine" ? mN + mOff + k : null,
            theirsN: ev.side === "theirs" ? tN + tOff + k : null,
            ...(ev.side === "mine" ? { mineText: ev.lines[k] } : { theirsText: ev.lines[k] }),
          });
          if (ev.side === "mine") stats.mineOnly++; else stats.theirsOnly++;
          merged.push(ev.lines[k]);
        }
        if (ev.side === "mine") mOff += ev.lines.length;
        else tOff += ev.lines.length;
      } else {
        // replacement / deletion over [ev.bStart, ev.bEnd)
        const baseCount = ev.bEnd - ev.bStart;
        const n = Math.max(baseCount, ev.lines.length);
        for (let k = 0; k < n; k++) {
          const hasBase = k < baseCount;
          const hasSide = k < ev.lines.length;
          rows.push({
            kind: ev.side,
            baseN: hasBase ? ev.bStart + k : null,
            mineN: ev.side === "mine" && hasSide ? mN + mOff + k : null,
            theirsN: ev.side === "theirs" && hasSide ? tN + tOff + k : null,
            baseText: hasBase ? base[ev.bStart + k] : undefined,
            ...(ev.side === "mine" ? { mineText: hasSide ? ev.lines[k] : undefined } : { theirsText: hasSide ? ev.lines[k] : undefined }),
          });
          if (ev.side === "mine" && hasSide) stats.mineOnly++;
          if (ev.side === "theirs" && hasSide) stats.theirsOnly++;
        }
        if (ev.lines.length < baseCount) {
          if (ev.side === "mine") stats.mineDel += baseCount - ev.lines.length;
          else stats.theirsDel += baseCount - ev.lines.length;
        }
        merged.push(...ev.lines);
        if (ev.side === "mine") {
          mOff += ev.lines.length;
          tOff += baseCount; // theirs kept these base lines
        } else {
          tOff += ev.lines.length;
          mOff += baseCount; // mine kept these base lines
        }
        idx = ev.bEnd;
      }
    }
    // trailing base lines kept by everyone up to `end`
    if (idx < end) {
      for (let k = idx; k < end; k++) {
        rows.push({ kind: "same", baseN: k, mineN: mN + mOff, theirsN: tN + tOff, baseText: base[k], mineText: base[k], theirsText: base[k] });
        stats.same++;
        merged.push(base[k]);
        mOff++; tOff++;
      }
    }
    mN += mOff;
    tN += tOff;
  }

  /* ---------- walk the merged event stream, grouping into clusters ---------- */

  let i = 0; // base cursor
  let ei = 0; // event index
  while (ei < events.length) {
    const ev = events[ei];
    if (ev.bStart <= i) {
      // start a cluster here
      const cluster: Ev[] = [ev];
      const start = ev.bStart;
      let end = Math.max(ev.bStart, ev.bEnd);
      ei++;
      // extend: subsequent events inside (or touching the right/insert edge of) the region
      while (ei < events.length) {
        const nxt = events[ei];
        // spans join when strictly overlapping the region; zero-width inserts join
        // when at-or-inside the region (same-anchor inserts must meet)
        const joins = ZERO(nxt) ? nxt.bStart <= end : nxt.bStart < end;
        if (!joins) break;
        cluster.push(nxt);
        end = Math.max(end, nxt.bEnd);
        ei++;
      }

      const hasMine = cluster.some((e) => e.side === "mine");
      const hasTheirs = cluster.some((e) => e.side === "theirs");

      if (hasMine && hasTheirs) {
        // contested? both sides changed inside the same region — compare full versions
        const mineVer = sideVersion("mine", cluster, start, end);
        const theirsVer = sideVersion("theirs", cluster, start, end);
        if (eqArr(mineVer, theirsVer)) {
          emitIdentical(cluster, start, end);
        } else {
          // genuine contest = overlapping spans, an insert strictly inside the other
          // side's span, or same-anchor inserts from both sides
          const mineSpans = cluster.filter((e) => e.side === "mine" && !ZERO(e));
          const theirsSpans = cluster.filter((e) => e.side === "theirs" && !ZERO(e));
          const overlap = mineSpans.some((m) =>
            theirsSpans.some((t) => m.bStart < t.bEnd && t.bStart < m.bEnd),
          ) || cluster.some((e) =>
            ZERO(e) && cluster.some((o) =>
              o !== e && o.side !== e.side && !ZERO(o) && o.bStart < e.bStart && e.bStart < o.bEnd,
            ),
          ) || cluster.some((e) =>
            ZERO(e) && cluster.some((o) => o !== e && o.side !== e.side && ZERO(o) && o.bStart === e.bStart),
          );
          if (overlap) emitConflict(cluster, start, end);
          else emitResolved(cluster, start, end);
        }
      } else {
        emitResolved(cluster, start, end);
      }
      i = Math.max(i, end);
    } else {
      // unchanged base line
      rows.push({ kind: "same", baseN: i, mineN: mN, theirsN: tN, baseText: base[i], mineText: base[i], theirsText: base[i] });
      stats.same++;
      merged.push(base[i]);
      mN++;
      tN++;
      i++;
    }
  }
  // trailing unchanged base lines after the last event
  while (i < base.length) {
    rows.push({ kind: "same", baseN: i, mineN: mN, theirsN: tN, baseText: base[i], mineText: base[i], theirsText: base[i] });
    stats.same++;
    merged.push(base[i]);
    mN++;
    tN++;
    i++;
  }

  return { rows, stats, merged, clean: stats.conflicts === 0 };
}
