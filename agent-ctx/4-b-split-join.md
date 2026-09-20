# Task ID: 4-b — Agent: split-join (general-purpose)

## Task
Client-side split/segmented file set detection (.001 / .r00 / .partN.rar / .z01+.zip) plus an in-browser joiner UI — exactly two new files, no edits to existing files.

## Files created
- `src/lib/splitjoin.ts` — pure TypeScript, zero imports, no DOM dependencies.
  - `export interface SegmentAnalysis { files; base; pattern; kind: "numeric" | "rxx" | "partN" | "zipx" | "unknown"; complete; missing; mergedName; count }`
  - `export const JOIN_SIZE_CAP = 512 * 1024 * 1024`
  - `export function analyzeSegments(files: File[]): SegmentAnalysis | null`
    - Parses case-insensitively: `X.001–999` (3-digit only, 1–999), `X.r00–r99` (companion `X.rar` = index 0, prepended when present), `X.partN.rar` (leading zeros accepted, N ≥ 1), `X.z01–z99` (companion `X.zip` = last part at maxZ+1).
    - Dedupes by lowercased name+size, groups by (kind, lowercased base), requires ≥ 2 files per set (a lone segment never qualifies → null), sorts by index, gap detection over the full expected range (numeric/partN 1..max; rxx 0..max including the .rar volume — missing .rar ⇒ missing=[0]; zipx 1..maxZ+1 including the trailing .zip slot — missing .zip ⇒ maxZ+1 in missing).
    - Multiple qualifying sets → largest count, then fewest missing, then alphabetical base. Unmatched files are ignored entirely.
  - `export async function joinFiles(files: File[], onProgress?: (doneBytes: number, totalBytes: number) => void): Promise<Blob>`
    - Checks the 512 MB cap BEFORE reading anything (friendly Error, sizes in MB), then awaits `file.arrayBuffer()` sequentially, pushes `Uint8Array` parts, reports (doneBytes, totalBytes) per completed file (monotonic), finally `new Blob(parts, { type: "application/octet-stream" })`.
- `src/components/omniscope/split-join-view.tsx` — "use client", fixed inset-0 overlay dialog (role=dialog, aria-modal), full-height flex column: header / scrollable body / action footer (safe-area padded).
  - Exports: `export function SplitJoinView({ initialFiles, onOpenMerged, onClose }: { initialFiles?: File[]; onOpenMerged: (file: File) => void; onClose: () => void }): React.JSX.Element` + `export default SplitJoinView` (+ `SplitJoinViewProps`).
  - Drop zone = focusable `<button>` (click→hidden multi-file input; drag/drop with stopPropagation on dragover/drop so the global app handler doesn't fire — the whole overlay accepts drops too). Working set dedupes by name+size, per-file remove, clear-all.
  - Live analysis via useMemo; "Detected pattern" card (imports Chip/Field/InfoGrid/SectionCard from viewer-ui): base, pattern description, count + total size, kind + complete/missing chips, ordered segment list (index chip + mono name + mono size), amber missing-part warnings with reconstructed filenames, editable merged-name input (per-suggestion override map — no setState-in-effect).
  - Emerald "Join files" button (disabled without a set, Loader2 spinner, progress bar with mono done/total bytes); result card keeps the joined Blob in state → "Open in Omniscope" calls `onOpenMerged(new File([blob], name, { type: "application/octet-stream" }))` and a real `<a download>` anchor; both re-usable. Inline rose error card for cap/read failures (never crashes).
  - Instructions card listing all 4 patterns with examples when no set is detected. Esc closes via capture-phase keydown + stopPropagation (app-level Esc stays quiet). Object URLs revoked on replace/unmount. framer-motion entrances, aria-labels, focus-visible rings.

## Verification
- `bunx eslint src/lib/splitjoin.ts src/components/omniscope/split-join-view.tsx` → 0 errors, 0 warnings.
- `bunx tsc --noEmit` → 0 errors in my two files (the only remaining project errors are in `audio-viewer.tsx`, which a concurrent agent modified — I did not touch it).
- Scratch bun logic test (`/tmp/splitjoin-test.ts`, deleted after): **51/51 pass** — covers numeric gap missing=[3], rxx rar-first ordering, rxx-without-rar missing=[0], partN order + leading zeros + gap, zipx z-order + missing trailing .zip + z-gap, no-match/mixed-unrelated/single-file/null cases, .000 rejection, case-tolerant grouping, name+size dedupe, multi-group largest-wins, dotted bases, joinFiles byte-concatenation order, progress start/finish/monotonic, 512 MB cap Error, read-failure propagation.
- `tail dev.log` → compiles clean, GET / 200, no breakage.

## Integration notes (for orchestrator)
- Wire-up: render `<SplitJoinView initialFiles={segmentFiles} onOpenMerged={(f) => addFiles([f])} onClose={() => setJoinOpen(false)} />` when opened files look like segments (families.ts `.NNN`/`.rNN`/`.zNN` records or `.partN.rar`), or behind a "Join" header button. Mount point doesn't matter — it renders as a self-contained fixed overlay (z-50).
- While open it deliberately swallows Esc and drag/drop (stopPropagation) so drops go to the joiner instead of opening as tabs.
- Worklog entry appended at the end of `/home/z/my-project/worklog.md` (Task ID: 4-b).
