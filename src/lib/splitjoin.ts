/* ------------------------------------------------------------------------- *
 * OMNISCOPE — split / segmented file detection & joining (task 4-b)
 *
 * Pure TypeScript, zero DOM dependencies (Blob / File are standard web types
 * available on the main thread and in workers alike). Everything runs in the
 * browser — bytes never leave the machine.
 * ------------------------------------------------------------------------- */

export interface SegmentAnalysis {
  files: File[];          // ordered by segment index
  base: string;           // filename without the segment suffix (e.g. "backup.7z")
  pattern: string;        // human description, e.g. ".001–.999 numeric segments"
  kind: "numeric" | "rxx" | "partN" | "zipx" | "unknown";
  complete: boolean;      // no gaps in the sequence
  missing: number[];      // missing segment indices
  mergedName: string;     // suggested output filename
  count: number;          // number of segments matched
}

/** Hard in-browser cap on the joined output size (512 MB). */
export const JOIN_SIZE_CAP = 512 * 1024 * 1024;

type SegKind = "numeric" | "rxx" | "partN" | "zipx";

interface ParsedSegment {
  kind: SegKind;
  base: string;
  index: number;
  file: File;
}

interface Group {
  kind: SegKind;
  base: string;     // original case, taken from the first member seen
  baseKey: string;  // lowercased base — grouping is case-tolerant
  members: ParsedSegment[];
}

/**
 * Try to read a filename as one segment of a known split convention.
 *
 *  - `.001` … `.999`  hjsplit / 7-Zip split volumes ("backup.7z.001")
 *  - `.r00` … `.r99`  old-style RAR volumes (the companion ".rar" is volume 0)
 *  - `.partN.rar`     new-style RAR multi-volume (".part01.rar" etc. accepted)
 *  - `.z01` … `.z99`  PKZIP spanning (the companion ".zip" is the LAST part)
 */
function parseSegmentName(name: string): { kind: SegKind; base: string; index: number } | null {
  // .001 … .999 — 3-digit numeric segments (hjsplit / 7-Zip split)
  let m = /^(.+)\.(\d{3})$/.exec(name);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n >= 1 && n <= 999) return { kind: "numeric", base: m[1], index: n };
  }
  // .r00 … .r99 — old RAR volumes; part number = N + 1 (index 0 is the .rar)
  m = /^(.+)\.r(\d{2})$/i.exec(name);
  if (m) return { kind: "rxx", base: m[1], index: parseInt(m[2], 10) + 1 };
  // .partN.rar — new RAR multi-volume (leading zeros accepted, N >= 1)
  m = /^(.+)\.part(\d+)\.rar$/i.exec(name);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n >= 1) return { kind: "partN", base: m[1], index: n };
  }
  // .z01 … .z99 — PKZIP spanning segments (the .zip is the trailing part)
  m = /^(.+)\.z(\d{2})$/i.exec(name);
  if (m) {
    const n = parseInt(m[2], 10);
    if (n >= 1) return { kind: "zipx", base: m[1], index: n };
  }
  return null;
}

/**
 * Detect whether a group of files forms a split/segmented set.
 * Returns null if not a recognizable split set.
 *
 * Files that match no segment pattern are simply ignored. If several distinct
 * sets are present, the largest (then most complete, then alphabetically first
 * base) wins. A lone segment never counts as a set — at least two parts
 * (including the .rar / .zip companion volumes where applicable) are required.
 */
export function analyzeSegments(files: File[]): SegmentAnalysis | null {
  if (!files || files.length === 0) return null;

  // De-duplicate: same lowercased name AND same size is the same segment.
  const seen = new Set<string>();
  const unique: File[] = [];
  const byLowerName = new Map<string, File>();
  for (const f of files) {
    if (!f || !f.name) continue;
    const key = `${f.name.toLowerCase()}|${f.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
    byLowerName.set(f.name.toLowerCase(), f);
  }
  if (unique.length === 0) return null;

  // Group recognized segments by (kind, lowercased base name).
  const groups = new Map<string, Group>();
  for (const f of unique) {
    const p = parseSegmentName(f.name);
    if (!p) continue; // not a segment — ignored
    const baseKey = p.base.toLowerCase();
    const key = `${p.kind}|${baseKey}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind: p.kind, base: p.base, baseKey, members: [] };
      groups.set(key, g);
    }
    if (g.members.some((mem) => mem.index === p.index)) continue; // duplicate part
    g.members.push({ kind: p.kind, base: p.base, index: p.index, file: f });
  }

  const candidates: SegmentAnalysis[] = [];

  for (const g of groups.values()) {
    const members = [...g.members];
    let pattern: string;
    let mergedName: string;
    let expectedMin = 1;
    let expectedMaxOverride: number | null = null;

    if (g.kind === "rxx") {
      // A matching base ".rar" (if present) is the FIRST volume — index 0.
      const rar = byLowerName.get(`${g.baseKey}.rar`);
      if (rar) members.unshift({ kind: "rxx", base: g.base, index: 0, file: rar });
      expectedMin = 0;
      pattern = rar
        ? ".r00–.r99 old-style RAR volumes + leading .rar"
        : ".r00–.r99 old-style RAR volumes (leading .rar volume not added yet)";
      mergedName = `${g.base}.rar`;
    } else if (g.kind === "zipx") {
      // A matching base ".zip" (if present) is the LAST part.
      const maxZ = members.reduce((mx, mem) => Math.max(mx, mem.index), 0);
      const zip = byLowerName.get(`${g.baseKey}.zip`);
      if (zip) members.push({ kind: "zipx", base: g.base, index: maxZ + 1, file: zip });
      else expectedMaxOverride = maxZ + 1; // the trailing .zip slot is missing
      pattern = zip
        ? ".z01–.zNN PKZIP spanning segments + trailing .zip"
        : ".z01–.zNN PKZIP spanning segments (trailing .zip not added yet)";
      mergedName = `${g.base}.zip`;
    } else if (g.kind === "partN") {
      pattern = ".part1.rar … .partN.rar RAR multi-volume segments";
      mergedName = `${g.base}.rar`;
    } else {
      pattern = ".001–.999 numeric segments (HJSplit / 7-Zip split)";
      mergedName = g.base;
    }

    if (members.length < 2) continue; // a single file is not a recognizable set

    members.sort((a, b) => a.index - b.index);

    // Gap detection over the expected index range.
    const present = new Set(members.map((mem) => mem.index));
    const maxIndex = members[members.length - 1].index;
    const expectedMax = expectedMaxOverride ?? maxIndex;
    const missing: number[] = [];
    for (let i = expectedMin; i <= expectedMax; i++) {
      if (!present.has(i)) missing.push(i);
    }

    candidates.push({
      files: members.map((mem) => mem.file),
      base: g.base,
      pattern,
      kind: g.kind,
      complete: missing.length === 0,
      missing,
      mergedName,
      count: members.length,
    });
  }

  if (candidates.length === 0) return null;

  // Several sets may be present — pick the largest, then the most complete,
  // then the alphabetically first base name.
  candidates.sort((a, b) =>
    b.count - a.count ||
    a.missing.length - b.missing.length ||
    a.base.localeCompare(b.base)
  );
  return candidates[0];
}

/**
 * Concatenate files (in the given order) into a single Blob, reporting
 * progress as (doneBytes, totalBytes). Throws a friendly Error when the
 * joined size would exceed the 512 MB in-browser cap.
 */
export async function joinFiles(
  files: File[],
  onProgress?: (doneBytes: number, totalBytes: number) => void,
): Promise<Blob> {
  const list = files ?? [];
  const totalBytes = list.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > JOIN_SIZE_CAP) {
    throw new Error(
      `Joined size would be ${(totalBytes / (1024 * 1024)).toFixed(1)} MB — over the ` +
      `${Math.round(JOIN_SIZE_CAP / (1024 * 1024))} MB in-browser limit. ` +
      `Join a smaller selection, or use a desktop tool for this set.`,
    );
  }

  const parts: BlobPart[] = [];
  let doneBytes = 0;
  onProgress?.(doneBytes, totalBytes);
  for (const file of list) {
    const buffer = await file.arrayBuffer();
    parts.push(new Uint8Array(buffer));
    doneBytes += file.size;
    onProgress?.(doneBytes, totalBytes);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}
