# Task 4-c — Agent: recent-files (general-purpose)

## Task
IndexedDB-backed recent files library + landing-page "RECENT FILES" chip row (two new files, no edits to existing files).

## Files created
- `src/lib/recent-files.ts` — raw IndexedDB (DB "omniscope-recents" v1, store "recent" keyPath "id", index "by_opened" on lastOpened), Blob cached on the same record only when size <= RECENT_CACHE_CAP (8MB), dedupe by name+size inside a single readwrite transaction (index cursor scan), store capped at 50 entries (oldest by lastOpened evicted), SSR/Node guard (`typeof indexedDB === "undefined"` → no-op/[]/null), never throws (all errors caught → console.warn).
- `src/components/omniscope/recent-panel.tsx` — "use client" horizontal chip row: lazy blob fetch on click only, lucide icons (FileImage/FileAudio/FileVideo/FileArchive/FileText/FileCode2/FileJson/File fallback), detected-format color dots, formatBytes + formatRecentWhen meta, per-chip hover X remove, inline "clear all → sure? yes/no" confirm, transient 2.5s amber "not cached — re-open from disk" hint, skeleton shimmer while loading, returns null when empty/IndexedDB unavailable, hydration-safe (post-mount load only).

## Work log
- Read worklog.md, landing.tsx (samples row + section label conventions), utils.ts (formatBytes verified), types.ts, eslint config, app-shell addFiles contract; verified all lucide icon exports exist (FileImage, FileAudio, FileVideo, FileArchive, FileText, FileCode2, FileJson, History, X).
- Wrote both files; fixed formatRecentWhen unit bug (min/3600 → min/60) caught by scratch test; typed component return as `React.JSX.Element | null` (spec mandates `return null` for the empty state, which plain `React.JSX.Element` rejects).
- Verification: `bunx eslint` both files → 0 errors/0 warnings. `bunx tsc --noEmit` → 0 errors in my files (only pre-existing errors in audio-viewer.tsx, a file modified by another agent, untouched by me). SSR-guard smoke test in bun (scratch): 15/15 pass (indexedDB undefined → [] / null / no-op, no throw; formatRecentWhen cases). Full IndexedDB logic test with fake-indexeddb in scratch: 17/17 pass (newest-first list, limit, blob round-trip, dedupe by name+size update, same-name-diff-size new entry, oversized → cached=false + blob null, remove single, cap at 50 with correct eviction, clear). react-dom/server renderToString smoke: skeleton + label render, default === named export. All scratch deleted.
- dev.log tailed: GET / 200, compiles clean, no breakage.

## Stage summary / integration notes
- Exact exports:
  - `src/lib/recent-files.ts`: `interface RecentEntry { id; name; size; mime; lastOpened; detectedName?; viewerId?; cached }`, `const RECENT_CACHE_CAP = 8*1024*1024`, `addRecentFile(file: File, detected?: { name?: string; viewer?: string }): Promise<void>`, `listRecentFiles(limit?: number = 20): Promise<RecentEntry[]>` (newest first, blobs stripped), `getRecentFile(id: string): Promise<{ entry: RecentEntry; blob: Blob | null } | null>`, `removeRecentFile(id: string): Promise<void>`, `clearRecentFiles(): Promise<void>`, `formatRecentWhen(ts: number): string`.
  - `src/components/omniscope/recent-panel.tsx`: `export function RecentFilesRow({ onOpenFile }: { onOpenFile: (file: File) => void }): React.JSX.Element | null` + `export default RecentFilesRow`.
- Orchestrator wiring (not done by me, per instructions): in app-shell's `addFiles`, after detection completes call `addRecentFile(file, { name: detected.name, viewer: detected.viewer })`; render `<RecentFilesRow onOpenFile={(f) => addFiles([f])} />` on the landing (e.g. right after the drop zone section, before the samples section — it self-hides when empty).
- Note: `addRecentFile` also refreshes mime/blob when deduping, so a re-opened cached file always has fresh bytes; entries whose blob was evicted/quota-failed report `cached: false` (computed from the actual blob presence at read time).
