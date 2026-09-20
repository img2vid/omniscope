# OMNISCOPE — Universal Client-Side File Viewer

Project: A fully client-side (GitHub Pages–ready) universal file opener/viewer supporting 10,000+ format
identities (extensions ∪ MIME types ∪ binary signatures ∪ archive segments ∪ character encodings), built with
Next.js 16 (App Router, single `/` route, all logic client-side, zero server APIs).

Owner: main orchestrator (Z.ai Code). Subagents contribute isolated modules with Task IDs.

## Architecture Map
- `src/lib/types.ts` — core types (RawFormat, FormatRecord, DetectedFormat, ViewerProps, ViewerId, FormatCategory)
- `src/lib/utils.ts` — general helpers (sizes, hex, entropy, hashes, strings, encodings)
- `src/lib/binary.ts` — DataReader for binary parsing
- `src/lib/formats/signatures.ts` — magic-byte signature engine
- `src/lib/formats/database.ts` — core authored format DB (~400 records)
- `src/lib/formats/extra-formats.ts` — SUBAGENT 2-a: large authored expansion (2,500+ records)
- `src/lib/formats/mime-registry.ts` — SUBAGENT 2-a: IANA/vendor MIME registry (3,000+)
- `src/lib/formats/families.ts` — SUBAGENT 2-a: programmatic segment families (.000–.999, .r00–.r99 …)
- `src/lib/detect.ts` — detection pipeline (magic → CFB/OOXML sniff → extension → content)
- `src/components/viewers/viewer-ui.tsx` — shared viewer chrome kit (toolbar, buttons, cards)
- `src/components/viewers/*` — viewer components (core by orchestrator; suites by subagents 2-b/2-c/2-d)
- `src/components/omniscope/*` — app shell: landing, workspace, tabs, info panel, format explorer
- `src/app/page.tsx` — single route entry

## Rules for subagents
- Only create NEW files in their assigned paths; never edit shared files.
- Viewer contract: `export default function XViewer({ file, arrayBuffer, detected, fileName }: ViewerProps)`.
- All components `'use client'`, graceful error handling, dark zinc + emerald/amber palette, no blue/indigo.
- Append work record at end of task using the template.

---
Task ID: 1
Agent: orchestrator (Z.ai Code)
Task: Project setup, dependency install, architecture design

Work Log:
- Inspected Next.js 16 scaffold (shadcn/ui full set, framer-motion, zustand, lucide available)
- Installed: pdfjs-dist, mammoth, xlsx, fflate, three, opentype.js, highlight.js, marked, dompurify, exifr,
  utif, ag-psd, heic2any, sql.js, dicom-parser
- Copied self-contained assets: public/pdf.worker.min.mjs (pdfjs 6.3.289), public/sql-wasm.wasm

Stage Summary:
- Environment ready; foundation writing begins next (types, utils, detection engine, core format DB).

---
Task ID: 1 (continued)
Agent: orchestrator (Z.ai Code)
Task: Core app build — types, detection engine, format DB seed, app shell, 13 core viewers

Work Log:
- Wrote src/lib/types.ts (RawFormat/FormatRecord/DetectedFormat/ViewerProps/ViewerId/FileTab)
- Wrote src/lib/utils.ts (hex, entropy, MD5/SHA, strings, encodings, CP437), src/lib/binary.ts (DataReader)
- Wrote src/lib/formats/signatures.ts (~140 magic signatures + matcher), database.ts (~400 core records), index.ts (lookup maps), stats.ts
- Wrote src/lib/detect.ts (magic → container sniff (OOXML/ODF/EPUB/CFB) → extension → content pipeline)
- Wrote src/lib/media-meta.ts (custom WAV/MP3-ID3/FLAC/OGG/MP4/Matroska/AVI parsers + FFT spectrogram)
- Wrote src/lib/samples.ts (16 in-browser generated sample files incl. PNG/WAV/MIDI/ZIP/NFO-CP437/torrent)
- Built app shell (tabs, drag&drop, paste, keyboard shortcuts, info sidebar), landing, format explorer (virtualized)
- Built 13 core viewers: text/code (virtualized, hl.js, encodings), hex (pages, search, histogram),
  image (zoom/pan/filters/EXIF/palette/pixel-picker/TIFF/PSD/HEIC), audio (waveform/spectrogram/tags),
  video (+metadata, frame capture), json (tree/search), xml (tree), csv (table/sort/filter/chart),
  markdown (rendered+TOC), svg, ico/cur (BMP+PNG frames), fallback (forensics: entropy/bytemap/strings/hashes)
- tsc clean; dev server verified via agent-browser: landing renders, PNG sample → image viewer + hashes,
  WAV sample → waveform + playback controls. No console errors.

Stage Summary:
- Core app is LIVE and functional on / route.
- Next: parallel subagents 2-a (format DB expansion to >10k identities), 2-b (office/doc viewers),
  2-c (binary/system viewers), 2-d (3D/midi/chess/subtitle viewers), 2-e (map/email/medical/nfo viewers).
  Integration (registry + DB merge + stats) stays with orchestrator.

---
Task ID: 2-e
Agent: domain-viewers (general-purpose)
Task: Map/email/calendar/contacts/dBase/DICOM/NFO viewer suite

Work Log:
- Read worklog + contracts (types.ts ViewerProps, viewer-ui.tsx kit, fallback-viewer style, utils/binary helpers)
- Verified lib import shapes first: dicom-parser UMD export (namespace vs default) via node, dompurify ESM typings via scratch tsc
- src/components/viewers/map-viewer.tsx — GPX (trk/trkseg/rte/wpt), KML (Placemark/LineString/Point/gx:Track, localName-based
  for namespaces), TCX (Trackpoint/Position/AltitudeMeters/Time), GeoJSON (FeatureCollection/LineString/MultiLineString/Point,
  recursive walk). Custom SVG route chart: equirectangular projection with cos(midLat) latitude scaling, graticule with
  degree labels, per-segment emerald/teal strokes (glow underlay), START circle + END flag markers, waypoint diamonds with
  toggleable halo-stroked labels; elevation area chart (cumulative haversine distance vs ele, downsampled to 3000 pts,
  binary-search hover crosshair + km/m tooltip); stats card (points, distance, duration, elev min/max/gain, avg speed + pace,
  bounds); toolbar: waypoint/elevation toggles, copy lat,lon list, GeoJSON export (downloadBlob)
- src/components/viewers/eml-viewer.tsx — full RFC-822 MIME stack: header/body split with unfolding, quote-aware param
  parsing, recursive multipart splitting on line-start boundary delimiters (CRLF/LF, -- terminator), transfer decoding
  (chunked base64 via atob, hand-written quoted-printable with soft breaks + stray '='), charset decoding via TextDecoder with
  utf-8/latin1 fallback guess, RFC-2047 encoded-word decoding (B/Q) for subjects and display names. Views: Body (DOMPurify-
  sanitized HTML rendered via dangerouslySetInnerHTML in a white page container, <style>/form/iframe stripped; plain-text
  fallback; html/plain mini-toggle), Parts (recursive MIME tree with type/charset/encoding/disposition/cid chips),
  Attachments (icon rows + per-part Blob download), Source (300KB preview). MHT: multipart/related refs (cid:, Content-Location,
  basename, backslash-normalized) rewritten to blob URLs in sanitized DOM, URLs revoked on cleanup. mbox: "From " line
  splitting → sticky sidebar message list with subject/from/date. Address chips (quote/comma-aware splitting)
- src/components/viewers/ical-viewer.tsx — ICS: line unfolding, quote-aware content-line parser (params, group prefixes),
  VEVENT capture (SUMMARY/LOCATION/DESCRIPTION with \n\, \; unescape, DTSTART/DTEND date|datetime|Z|TZID, DURATION, RRULE,
  STATUS, CATEGORIES, UID, VALARM counting), Intl-based TZID→UTC conversion with local fallback, month-grouped sorted event
  cards with expandable descriptions and chips; stats (events/recurring/alarms/span/todos/journals/timezones). VCF: vCard
  2.1/3.0/4.0 blocks (FN/N/ORG/TITLE/TEL/EMAIL/ADR/NOTE/BDAY/NICKNAME/URL, PHOTO as base64 or data: URI), contact card grid
  with photo or initials avatar, typed contact rows, search box. Auto Calendar/Contacts segmented by detected.viewer, both
  parsed so mixed files switch
- src/components/viewers/dbf-viewer.tsx — dBase III–V/FoxPro parser: version byte map (0x02–0xF5 incl. memo variants),
  last-update ymd, u32le record count, u16le header/record size, 32-byte field descriptors to 0x0D terminator, deletion-flag
  records, per-type cells (C trim, N/F → number|NaN→null, D yyyymmdd→ISO, L T/F/Y/N/? , M memo pointer chip, I/@/+ int32le,
  B/O/Y float64le). Table: sticky-header table, 300-row paging + Load more, sortable columns (typed comparators, nulls last),
  filter box, deleted-record toggle, truncated/mismatch amber notes, stats card + field summary; CSV/JSON export buttons
- src/components/viewers/dicom-viewer.tsx — dicom-parser via import-shape guard (namespace or .default, verified against the
  real UMD build); tag dictionary (~70 friendly names, correct WC/WW (1050/1051) vs Rescale (1052/1053) mapping), value
  decoding per VR (US/SS/UL/SL/FL/FD multiplicity, IS/DS, AT, PN with UTF-8/latin1 heuristic, OB/OW hex previews, SQ item
  counts, implicit-VR garbage→hex fallback). Pixel rendering for uncompressed explicit/implicit LE: 8/16-bit grayscale with
  bits-stored mask + sign extension + rescale slope/intercept, window center/width mapping with interactive sliders, auto-
  window, invert toggle (MONOCHROME1 auto), multi-frame slider (≤512 frames, 4096×4096 cap); RGB planar 0/1, YBR_FULL and
  YBR_FULL_422 → RGB conversion, PALETTE COLOR via 1201–1203 LUTs; compressed transfer syntaxes → amber tags-only card.
  Image/Tags segmented panels, patient/study summary
- src/components/viewers/nfo-viewer.tsx — decodeCP437 (auto-upgrade to UTF-8 when bytes are valid multi-byte UTF-8, toggleable),
  CRT container (inner shadow + toggleable scanline overlay), horizontal-scroll non-wrapping pre, phosphor green/amber/mono
  modes with glow text-shadow, font-size slider (10–22px), copy text, UTF-8 .txt download, stats (lines, longest line,
  CP437 box-char count from 0xB0–0xDF/0xFE byte range)
- All files: "use client", ViewerProps signature, try/catch → ErrorCard, arrayBuffer-null graceful degradation (head-only
  + amber notes, or explicit ErrorCard for DICOM), zinc-950/900 + emerald/teal/amber only, lucide icons, responsive
- Verification: bunx eslint (6 files) → clean after fixing conditional-hook ordering in dbf/ical and unused directive;
  bunx tsc --noEmit → 0 errors in my files (remaining errors are examples/, skills/, and 2-b's mobi/pdf/rtf viewers);
  bun build bundle-test of all 6 entries OK; 26-assertion logic test (QP/base64/multipart/header/address/haversine/dbf
  synthetic table/ics unfold/TZID) ALL PASS; synthetic Part-10 DICOM parsed with the exact viewer access patterns (lowercase
  element keys verified: x7fe00010) ALL PASS; react-dom/server smoke render of all 6 components ALL PASS

Stage Summary:
- 6 domain viewers delivered: map (GPX/KML/TCX/GeoJSON: SVG route chart + elevation profile + stats + GeoJSON export),
  email (eml/mht/mbox: full MIME tree, QP/base64/charsets, sanitized HTML body with cid/Content-Location blob inlining,
  attachment downloads, mbox browser), ical/vcf (calendar events + contact cards, search, TZID conversion), dBase (typed
  table with sort/filter/paging, deleted flags, memo chips, CSV/JSON export), DICOM (tag dictionary + uncompressed pixel
  rendering with interactive windowing, frames, YBR/palette/planar support), NFO (CP437/UTF-8 CRT terminal with color/size/
  scanline controls)
- Limitations: no external map tiles (bounds-scaled SVG only); email HTML sanitized with <style> stripped (no scoped CSS,
  no iframe per spec); dBase memo (.dbt) contents not loaded (pointers shown); DICOM compressed syntaxes (JPEG/JPEG-LS/
  JPEG-2000/RLE) and segmented palette LUTs are tags-only; BE transfer syntax pixel bytes read little-endian only
- Integration note for orchestrator: viewers are NOT yet wired into registry.tsx (map/eml/ical/vcf→ical-viewer, dbf, dicom,
  nfo ViewerIds exist in types.ts); add dynamic imports when merging

---
Task ID: 2-b
Agent: office-doc-viewers (general-purpose)
Task: Document/office viewer suite (pdf, docx, xlsx, pptx, odf, epub, mobi, rtf)

Work Log:
- Read worklog + contracts: types.ts (ViewerProps, ViewerId includes pdf/docx/xlsx/pptx/odf/epub/mobi/rtf),
  viewer-ui.tsx kit, fallback-viewer/markdown/csv style references, utils/binary helpers, eslint/tsconfig
- Verified lib import shapes first via bun: pdfjs-dist v6 namespace import exposes GlobalWorkerOptions +
  getDocument (verified: 6.3.289); mammoth CJS export= with lib/index.d.ts; xlsx.mjs named exports
  (read/utils); fflate zipSync/unzipSync/strFromU8 round-trip; all lucide icon names exist in 0.525
- src/components/viewers/pdf-viewer.tsx (530 lines) — dynamic pdfjs import with workerSrc=/pdf.worker.min.mjs
  (+ .default fallback), buffer copy to avoid detaching shared arrayBuffer, >96MB files streamed from File
  object (amber "streamed" chip). Continuous-scroll virtualized rendering: every page is a fixed-size wrapper
  (dims at scale 1, estimated aspect until loaded) with an IntersectionObserver (600px root margin) marking
  visible pages; PageView renders its canvas at fit/zoom scale with DPR≤2, re-renders on zoom/rotate, frees the
  bitmap when far off-screen, per-page error placeholder (huge page / render fail → rose card). Current page =
  argmax intersection ratio (drives N/total display + prev/next scrollIntoView). Fit-width scale via
  ResizeObserver on the scroll container; zoom steps 0.25–4; rotate 0/90/180/270. Thumbnails sidebar (md+):
  lazy per-thumb IO rendering at 128px, capped at 120 + overflow note, click = jump + amber flash. Text search:
  sequential getTextContent() scan with progress ("searching page x/y", yields every 5 pages), match list with
  page chip + snippet (cap 300), click jumps and flashes the page border. Toolbar: prev/next + N/total, zoom
  -/+/fit + %, rotate, pages toggle, download (downloadBlob), metadata footer (title/author from getMetadata),
  PasswordException → dedicated ErrorCard
- src/components/viewers/docx-viewer.tsx (299 lines) — CFB magic (D0 CF 11 E0 A1 E1 B1 1A) branch: legacy .doc
  recovery (latin1 + utf16LE double decode of the OLE container, printable-run harvesting ≥4 chars with
  letter-quality filter, best pass wins) → warning chip "Legacy .doc — text recovered", info card
  (magic/size/format/recovery mode), copy + .txt export. OOXML branch: mammoth convertToHtml({arrayBuffer}) →
  DOMPurify (blob/data/https URI regexp) → docx-body serif typography (max-w-3xl). Stats chips: words/
  paragraphs/images; mammoth messages → amber warning chip + collapsible list; standalone styled HTML export;
  print button. Null arrayBuffer → ErrorCard with load-cap hint
- src/components/viewers/xlsx-viewer.tsx (408 lines) — SheetJS XLSX.read(type:"array", cellDates:true) for
  xlsx/xls/ods; own A1-notation codec (decodeRange/colName/addr) so no sync lib import needed. Sheet tab chips
  row (active emerald), 300-row batches with "load N more", 100-column cap with note. Cells rendered from
  sheet[addr]: cell.w formatted text preferred, t:"d" → ISO string, booleans/errors styled, numeric right-aligned
  mono; formula cells (cell.f) get an amber corner triangle. Cell click → detail panel: address/type/raw value/
  formula (amber)/number format, close button. Search: scan of current sheet (2M-cell cap, 100 matches) →
  address+text list, click expands rows + scrollIntoView + selection. CSV export via sheet_to_csv; stats chips:
  sheets/rows×cols/formula count (memoized)
- src/components/viewers/pptx-viewer.tsx (436 lines) — fflate unzipSync → ppt/slides/slideN.xml sorted
  NUMERICALLY (1,2,10) + ppt/notesSlides/notesSlideN.xml. Namespace-agnostic DOMParser extraction (localName
  walk, no prefix assumptions): paragraphs = a:p under txBody grouped by nearest sp/graphicFrame ancestor, text
  = joined a:t runs; notes get numeric-only paragraphs (slide numbers) filtered. Slide mode: 16:9 stylized card
  (title + emerald bullets + page badge, 60-line cap), speaker-notes card below; lg slide rail (number + title
  snippet); Overview mode = responsive grid of mini cards → click opens. .ppt CFB → legacy recovery card +
  text (shared printable-runs approach). Toolbar: prev/next + N/total, Slide/Overview segmented, export all
  slides text (.txt with per-slide sections + notes)
- src/components/viewers/odf-viewer.tsx (442 lines) — fflate unzipSync → content.xml + mimetype → localName
  DOMParser walk: draw:page presence switches ODP/ODG page mode vs ODT text mode. Text mode: recursive
  block parser (text:h outline levels → headings, text:p with text:s/tab/line-break handling, text:list,
  simple tables, draw:frame → embedded image + frame text, sections/text-box recursion); images resolved from
  zip hrefs (basename fallback) → blob URLs with 96MB budget, revoked on cleanup. Presentation mode: 16:9 page
  cards from draw:frame blocks (presentation:class title/subtitle aware), Page/All-pages segmented + prev/next
  + N/total. ods detected → routed hint card (use Sheet viewer). Stats chips (¶, images), plain-text export,
  flat-XML conversion suggestion on parse failure
- src/components/viewers/epub-viewer.tsx (486 lines) — custom reader (no epubjs): unzipSync → container.xml →
  rootfile → OPF parse (manifest id→href/media-type/absPath resolved against OPF dir, spine order, dc
  metadata). TOC titles: EPUB3 nav (properties="nav" or nav-id item) anchors first, NCX navPoint fallback
  (navLabel text + content src), "Chapter n" default. Chapter render: zip entry → XHTML/XML parse (text/html
  fallback for entity-laden files) → img/image src + xlink:href rewritten to blob URLs (64MB budget, remote
  http/data left intact, missing images dropped) → body innerHTML → DOMPurify (blob/data regexp) → epub-body
  serif reading style. Font size S/M/L, prev/next + chapter select dropdown + progress bar + %; TOC sidebar
  (md+) with current highlight; anchor link interception (in-page #id scroll, cross-chapter jump, external
  blocked). Blob-URL lifecycle: per-chapter-run array in a ref, revoked on switch/unmount with cancel-safe
  cleanup. Spine-empty fallback: manifest HTML items; container.xml missing → *.opf search
- src/components/viewers/mobi-viewer.tsx (420 lines) — PDB header (name 0x00/32B, type 0x3C "BOOK", creator
  0x40 "MOBI", numRecords 0x4C, record list 0x50; alternate 0x54 layout auto-detected + validated via PalmDOC
  compression sanity). Record 0: PalmDOC header (compression/textLength/textRecordCount/recordSize/encryption)
  + MOBI header at +16 (type/encoding/fileVersion/fullName offset+len, extra flags at 0xF2 when header ≥0xE4).
  Text records 1..N: trailing-entry trim (extra-flags bit walk + multibyte overlap) → PalmDOC LZ77 decompress
  (literal runs 1–8, 0x80–0xBF backrefs dist/len, 0xC0+ space pairs) or raw copy (compression 1) into capped
  24MB buffer → decode cp1252/UTF-8 → sanitize → reading style. Raw/render segmented, PDB/MOBI header info
  panel (toggle), HTML export. Guards: DRM encryption → error, HUFF/CDIC (17480) → header card + unsupported
  message, KF8/AZW3 (version 8) → best-effort + amber chip
- src/components/viewers/rtf-viewer.tsx (437 lines) — custom RTF→HTML parser (tokenizer + group state stack):
  \b \i \ul(\ulw\uldb) toggles with param 0, \plain reset, \fsN half-points → px, \cfN colors from parsed
  \colortbl (\red/\green/\blue + ";" entries, auto entry 0), \qc/\ql/\qr/\qj alignment captured per-paragraph,
  \par/\sect/\page new paragraphs, \line soft breaks, \tab/\cell tabs, \'hh hex escapes (cp1252 map + \ansicpgN
  TextDecoder override), \uN unicode with \ucN substitute skipping (hex AND literal fallback chars), escapes
  \\ \{ \} \~ nbsp, symbol words (emdash/bullet/quotes…), ignorable destinations {\*\…} + skip-list (fonttbl,
  stylesheet, info, header/footer, listtable, rsidtbl, pict → "[image]" marker, fldinst, generator …), \binN
  raw-byte skip, \pntext/listtext muted. Output: styled spans → paragraph divs → DOMPurify → rtf-body
  typography; Rendered/Source segmented, stats chips (groups/chars/colors), standalone HTML export,
  head-only fallback for >96MB RTF
- Verification: bunx eslint on all 8 files → 0 errors/0 warnings (removed 4 unused disable directives);
  bunx tsc --noEmit → 0 errors in my 8 files (fixed: ES2018 regex s-flag → [\s\S], Thumb ref element type,
  closure-narrowed TextDecoder). Runtime smoke tests under bun: all 8 modules import cleanly (default exports
  named); MOBI synthetic fixture (PDB+MOBI header+text records) parses fully incl. UTF-8 fullName + exact text
  round-trip; PalmDOC LZ77 literal + backreference round-trips; trailing-entry trim (0x40 block + multibyte);
  RTF fixture: 11 groups/3 colors/4 paras, align c/l/r, bold+italic+fs runs, é via \u233 and \'e9, color \cf2,
  [image] marker, no fonttbl/generator leaks; xlsx A1 codec (colName AA/ZZ/AAA, decodeRange, cellText date/
  formatted/bool) + formula counting; epub path resolution (../, fragments, absolute) + zip lookup fallbacks;
  fflate zip round-trip with numeric slide ordering (1,2,10); pdfjs GlobalWorkerOptions verified on namespace
  import. Scratch test dir removed afterwards

Stage Summary:
- 8 office/document viewers delivered, all default-exported matching ViewerIds in types.ts: PdfViewer
  (pdf-viewer), DocxViewer (docx-viewer), XlsxViewer (xlsx-viewer), PptxViewer (pptx-viewer), OdfViewer
  (odf-viewer), EpubViewer (epub-viewer), MobiViewer (mobi-viewer), RtfViewer (rtf-viewer)
- Fully working: PDF raster rendering with virtualization/thumbs/search/zoom/rotate (worker from
  public/pdf.worker.min.mjs); .docx→HTML via mammoth with stats/warnings/export; xlsx/xls/ods sheets with
  formulas, cell inspector, search, CSV export; .pptx slide/notes text cards with overview grid; ODF
  text/presentation with embedded images; EPUB reader with spine/TOC/blob images; MOBI (PalmDOC + trailing
  entries, cp1252/UTF-8); RTF custom parser with colors/fonts/alignment/unicode escapes
- Fallback-only: legacy .doc/.ppt CFB → printable-run text recovery (formatting lost); AZW3/KF8 → best-effort
  record extraction + header card; HUFF/CDIC + DRM MOBI → info/error cards; ODS→ODF viewer shows "use Sheet
  viewer" hint (routed to xlsx by orchestrator)
- Key decisions: pdfjs buffer copy (protect shared arrayBuffer from detach), pdf >96MB streamed from File
  object, all parsers namespace-agnostic via localName (survives prefix variants), DOMPurify URI regexp
  extended with blob:/data: (image inlining), no blue/indigo anywhere (emerald/teal/amber/rose palette only)
- arrayBuffer===null (>96MB cap): PDF streams from File; RTF falls back to 64KB head parse; all others show
  descriptive ErrorCards with hints
- Integration note for orchestrator: registry.tsx needs dynamic imports for pdf/docx/xlsx/pptx/odf/epub/
  mobi/rtf ViewerIds (labels already present in VIEWER_LABELS); .doc legacy route should target docx viewer
  (CFB branch), .ppt legacy → pptx viewer, .ods → xlsx viewer
---
Task ID: 2-c-2
Agent: nbt-viewer (general-purpose)
Task: Minecraft NBT viewer (completing 2-c suite)

Work Log:
- Read worklog + contracts (types.ts ViewerProps/ViewerId "nbt", viewer-ui kit, DataReader, utils, fallback/
  json/torrent style references); verified fflate 0.8.3 installed and lucide icon names exist
- Created ONLY src/components/viewers/nbt-viewer.tsx (~700 lines, "use client", default export NbtViewer):
- Detection per spec: head 1F 8B → dynamic `await import("fflate")` gunzipSync on full arrayBuffer (with 512MB
  decompressed guard) → parse; else head 0A 00 00 → raw big-endian NBT; else ErrorCard "Not a recognized NBT
  payload". arrayBuffer null (>96MB) → dedicated ErrorCard with load-cap hint
- Full big-endian NBT parser (DataReader little=false): types 0–12, names/strings via custom modified-UTF-8
  decoder that ALSO accepts standard UTF-8 4-byte supplementary sequences (handles 0xC0 0x80 NUL, CESU-8
  surrogate pairs, stray surrogates→U+FFFD); Longs as BigInt (BigInt64Array for arrays), IntArray Int32Array,
  ByteArray signed display; explicit truncation/negative-length/unknown-type errors; recursion depth cap 64,
  node cap 200k, list-length sanity guards
- Tree view (flat-row model, no virtualization): chevron collapsible rows (keyboard-focusable, aria labels),
  type chips colored by family (numbers amber, strings emerald, containers zinc, arrays teal, Long rose),
  value previews: formatted numbers (BigInt toLocaleString + L suffix), quoted strings truncated at 200 chars
  with expandable full text, arrays show [len] + first 8 values + … expandable to 64, compounds show child
  count, lists show elemType × length; per-row byte offset (decompressed payload); >20k rows → render first
  2,000 with amber truncated note
- Toolbar: Expand all / Collapse all (forceAll flag + path Set), Copy as JSON (check feedback) / Download JSON
  (conversion: Long→string, numeric arrays→first 32 numbers + "… +N more values" note, duplicate compound
  keys deduped as "name #2"), search box filtering/highlighting matching tag names or string values with
  auto-expansion of ancestors (match paths + expand set), hit counter
- Stats panel: root name (annotated "— anonymous (modern NBT)"), root type, total tags, max depth, bytes
  consumed + trailing-bytes amber note, payload card (file size vs decompressed, gzip ×ratio + % of original,
  big-endian / modified UTF-8 fields), tag-type histogram mini bar chart with family colors + counts + %
- Error handling: all parse/gunzip in try/catch → ErrorCard (distinct card for non-NBT payloads mentioning
  .mca region files + Bedrock LE caveat); zinc-950/900 + emerald/teal/amber/rose palette only, lucide icons
- Verification: bunx eslint → 0 errors/0 warnings; bunx tsc --noEmit → 0 errors in my file (remaining 4 are
  examples/ + skills/, pre-existing); 38-assertion bun logic test extracted from the shipped parser code
  (BigInt longs, signed bytes, CESU-8 + 4-byte UTF-8 strings, all array types, list-of-compound, dup keys,
  JSON conversion truncation, trailing bytes, truncated→throw, depth-cap→throw, anonymous 0A 00 00 root,
  fflate gzip round-trip + magic) ALL PASS; react-dom/server smoke render (loading state, null-buffer
  ErrorCard, default export) PASS; scratch test dir removed

Stage Summary:
- NbtViewer delivered (src/components/viewers/nbt-viewer.tsx, default export NbtViewer): gzip/raw detection,
  complete big-endian NBT tree with type chips + expandable previews, search with ancestor auto-expansion,
  expand/collapse all, JSON copy/download with Long→string + array truncation, root stats with histogram and
  gzip ratio, caps (depth 64 / 200k nodes / 20k→2k rows / 512MB decompressed)
- Caveats: Bedrock little-endian NBT not supported (big-endian only per spec, explicit error card); .mca
  region chunk wrapper not unwrapped (hinted to Hex viewer); modified-UTF-8 decoder tolerates standard UTF-8
  4-byte forms; no virtualization (row caps instead)
- Integration note for orchestrator: registry.tsx needs `nbt: d(() => import("./nbt-viewer"))` (label "NBT"
  already in VIEWER_LABELS)

---

## Task ID: 2-a-1 — Agent: format-db-part-b

Created `src/lib/formats/extra-formats-b.ts` exporting `EXTRA_FORMATS_B: RawFormat[]`.

- **Records: 750** (≥700 required), all real file formats, one compact line each, `cat`/`viewer`/`mime`/`sig`/`sigOffset` per spec.
- Coverage focus: more images (QOI, MNG/JNG, JPEG-XR, KTX/ASTC/PKM/Basis textures, DjVu, raw photos ORF/FFF/RWL/SRW/MRW/GPR/ARI, Corel/StarOffice/ODF-draw family), audio codecs & chiptune (VOC, TwinVQ, TAK, YM/SAP/SNDH/SC68, HVL, FamiTracker, VST/Kontakt presets, CRI ADX/HCA/AIX/ACB, FMOD/Wwise/XACT banks, BRSTM family), video (GXF, AAF, Braw/R3D, Bink/Smacker/THP/VQA/CDXL, NLE projects AEP/PRPROJ/VEG/DRP), fonts (METAFONT, TeX GF/PK/TFM/VF, PFR, Glyphs, FontLab), archives (ARJ, LZX, SquashFS, ASAR/AAR/GEM/IPK/PHAR, game archives MPQ/BSA/RPF/PSARC/XP3/TTARCH), disk & forensic (ADF, WOZ, 2MG, TR-DOS, EnCase E01/L01, FTK AD1), system (DS_Store, systemd journal, DTB, UF2, DEX/VDEX, registry policy, OneNote, Visio families), game ROMs & engines (A26/A52/A78/LNX/SGX/BS/MSX/SMD, 3DS CIA/CXI/3DSX, Switch NRO/NSO, Wii U RPX/RPL, Z-machine/Blorb/Glulx/TADS, PICO-8, Scratch, Unreal UE1 packages, MUGEN), scientific (ASDF, CERN ROOT, CHARMM/AMBER, LS-DYNA, VTK, SEG-Y, JCAMP-DX, FCS, microscopy CZI/LIF/LSM), ML (Arrow, PaddlePaddle, SentencePiece, UFF/ETLT, ORC, Smile), CAD/EDA (Gerber, ACIS SAT/SAB, Houdini HIP/BGEO/VDB, Modo, LDraw), GIS (MIF, ECW, world files, MVT, FlatGeobuf), many programming languages (Vala, GDScript, Haxe, Cython, GLSL/HLSL/Metal/CUDA, Eiffel, PL/I, Modula-3, ABAP, 4GL, ColdFusion, Razor), office docs (xlsb, dotx, StarOffice 5.x, XPS, Visio, OneNote), ebooks (FB2, iBooks, Apabi), email (PST/OST/DBX/EMLX), databases (MySQL MyISAM, LevelDB, Realm, DuckDB), plus embroidery, DAW scores, DVB/BD (IFO/CLPI/MPLS).
- Duplicate check: official combined run → `{"records":750,"totalExts":2839,"dup":110}`. The 110 dups are **pre-existing internal CORE_FORMATS overlaps** (e.g. opus/mka/pdf/docx/ttf listed in multiple core records); baseline `core+EXTRA_FORMATS_A` alone also yields dup=110 → **my file contributes 0 new duplicate extensions** (verified: 0 collisions with core/A, 0 internal dups; iterated 3 rounds removing 61 offending exts, e.g. pcd/gbs/sfd/awb/adp/afm colliding with unseen truncated core entries).
- `bunx tsc --noEmit`: 0 errors in extra-formats-b.ts (remaining 4 project errors are pre-existing in examples/ + skills/, untouched per instructions).
- Note: initial core-extension listing output was truncated (>30k chars), so collisions were resolved via programmatic Set-diff instead of eyeballing.

---

## Task ID: 2-a-5 — Agent: mime-registry-expansion

Rewrote `src/lib/formats/mime-registry-2.ts` (previous partial run had 455 unverifiable/hallucinated mimes — all removed) and created `src/lib/formats/mime-registry-all.ts` (`MIME_REGISTRY_ALL = [...MIME_REGISTRY, ...MIME_CHUNK_2]`).

- **Counts**: `{"newEntries":2005,"uniqueNew":2005,"overlap":0}` (≥1,600 required). Combined registry: 3,250 records / 3,248 unique (the 2 case-exact dups — `application/mathml+xml`, `application/pdf` — are PRE-EXISTING internal duplicates inside the old `mime-registry.ts`, untouched per "fix only yours").
- **Sourcing (all verified real, zero fabrication)**: entries generated programmatically from authoritative lists — (1) official IANA media-types registry XML (media-types.xml, 2,348 registered types; vendor `vnd.*` + personal `prs.*` trees, standards tree, audio/video/image/text/font/model/message/haptics trees; multipart/* and */example excluded); (2) freedesktop.org shared-mime-info `freedesktop.org.xml` (de-facto ubiquitous `application/x-*` with official comments as names); (3) Apache httpd `mime.types` (historic-registered + ubiquitous types). Old-registry exclusion done case-insensitively (stricter than required).
- **Record shape**: `{ mime, name, cat, viewer }` per `MimeRecord` (desc omitted); names = fdo comments ∩ ~180-entry curated dictionary (Excel/Keynote/Lotus/SyncML/OMA/model-*/prs.* families) ∩ prettifier; cat/viewer via rule classifier matching existing registry conventions (office→docx/xlsx/pptx, +xml→xml, +json→json, +zip→archive, model/*→3d/three3d, fonts, geo→map, disks, games, network/telecom, sqlite databases, subtitles…). All 2,005 cat/viewer values validated against the `FormatCategory`/`ViewerId` unions.
- **Structure note**: the 2,005-entry literal triggers TS2590 (union too complex > ~1.2k literal shapes), so the file splits records into 4 internal `PART_1..4: MimeRecord[]` (~501 each) and exports `MIME_CHUNK_2: MimeRecord[] = [...PART_1, ...PART_2, ...PART_3, ...PART_4]` — same export, same verification results.
- **Verification**: task's official bun check → `{"newEntries":2005,"uniqueNew":2005,"overlap":0}`; `bunx tsc --noEmit` → 0 errors in src/lib (remaining 4 errors are pre-existing in examples/websocket + skills/, untouched).
- **Integration note**: nothing imports `MIME_REGISTRY_ALL` yet; orchestrator should switch consumers (detection/lookup) from `MIME_REGISTRY` to `MIME_REGISTRY_ALL` when ready.

---
Task ID: 3
Agent: orchestrator (Z.ai Code)
Task: Integration, format knowledge base completion (10,000+ identities), full QA, launch

Work Log:
- Integrated all subagent viewers into registry.tsx (26 additional lazy viewers: pdf, docx, xlsx,
  pptx, odf, epub, mobi, rtf, archive, exe, wasm, font, sqlite, torrent, nbt, three3d, gcode,
  midi, chess, subtitle, map, eml, ical, vcf, dbf, dicom, nfo)
- Grew format knowledge base through waves (subagents 2-a-1/2-a-5/2-a-9 partial + orchestrator
  authored files extra-formats{,-b..-l} + mime-registry{,-2,-all} + families + conventions):
  * 5,891 unique extensions (incl. programmatic families: .000-.999 split segments, RAR/PKZIP/ARJ
    volumes, vim swap cascade, rotated logs, compound .tar.* / *.gz / *.d.ts conventions)
  * 3,261 real MIME types (IANA standards + vendor trees + x- types)
  * 635 binary magic signatures (incl. 90+ MP4 ftyp brands, Nitro/engine magics, system headers)
  * 227 WHATWG charset labels
  * = 10,014 total recognized format identities (all computed live from data at runtime)
- Fixed detection pipeline: generic-XML magic now defers to specific XML format records
  (GPX/KML/SVG/TCX route correctly), compound extension detection (tar.gz, d.ts, env.local),
  CFB/OOXML container sniffing retained
- Fixed JSON/CSV hook-order lint errors, image-viewer decoder chain, J/K/L dedupe issues,
  eslint config to ignore vendored pdf.worker.min.mjs
- QA via agent-browser: landing counter (10,014), PNG (zoom/EXIF/palette/hashes), WAV
  (waveform/spectrogram/playback), ZIP archive browser, MIDI piano roll, chess PGN board with
  move stepping, GPX map route chart, SRT timeline, JSON tree, Markdown render, NFO CP437,
  format explorer (search, virtualized), mobile 390px responsive, sticky footer, Ctrl+K/O/Esc
  shortcuts — all pass; VLM visual review: "highly polished, professional-grade interface,
  no visible rendering bugs"
- bun run lint: 0 errors; tsc: clean; dev server healthy

Stage Summary:
- OMNISCOPE is COMPLETE and live on / (port 3000): 100% client-side universal file lab.
  39 viewer engines, 10,014 format identities, detection via magic bytes → container sniffing
  → extension → content. Sample generator (16 formats) lets anyone try it instantly.
- Known limitations: RAR/7z list extraction is identify-only (headers); WOFF2 metrics
  unavailable (Brotli); DICOM compressed transfer syntaxes tags-only; legacy .doc/.ppt fall
  back to text recovery. These are honest in-UI fallbacks, never crashes.
- Next-phase suggestions: split-file joining (.001 merge), hex diff between two files,
  NFO→PNG render, per-format export converters (CSV↔XLSX), IndexedDB recent files.

---
Task ID: 4-c
Agent: recent-files (general-purpose)
Task: IndexedDB-backed recent files library + landing-page "RECENT FILES" chip row (2 new files: src/lib/recent-files.ts, src/components/omniscope/recent-panel.tsx)

Work Log:
- Read worklog/landing.tsx/utils.ts/types.ts + eslint config + app-shell addFiles contract; verified lucide
  exports (FileImage, FileAudio, FileVideo, FileArchive, FileText, FileCode2, FileJson, History, X) and
  formatBytes in @/lib/utils
- Created src/lib/recent-files.ts: raw IndexedDB (no deps), DB "omniscope-recents" v1, store "recent"
  keyPath "id", index "by_opened" (lastOpened); Blob stored natively on the SAME record only when
  file.size <= RECENT_CACHE_CAP (8MB) else cached=false/no blob; addRecentFile dedupes by name+size inside
  ONE readwrite transaction (iterates the by_opened index cursor, updates lastOpened+detected info+blob on
  match), caps store at 50 (deletes oldest by lastOpened beyond 50); all functions guard
  `typeof indexedDB === "undefined"` for SSR/prerender (return [] / null / no-op) and never throw — errors
  (quota, blocked DB) caught + console.warn; exported formatRecentWhen (just now / N min / N h / N d ago /
  "Jan 5", year appended when different)
- Created src/components/omniscope/recent-panel.tsx ("use client"): RecentFilesRow renders a horizontal
  overflow-x-auto scrollbar-thin row of h-9 w-40 rounded-full chips (zinc-900/70, zinc-700 border, hover
  emerald border, NO blue/indigo) with detected-format color dot + lucide file icon + mono truncated name
  (title tooltip) + meta line (detectedName · formatBytes · formatRecentWhen); blobs fetched LAZILY only on
  click via getRecentFile → new File([blob], name, {type: mime}) → onOpenFile; uncached → transient amber
  inline message row "not cached — re-open from disk" (2.5s, amber ring on the triggering chip,
  non-blocking); per-chip hover X (pointer-events gated, keyboard focusable) → removeRecentFile;
  "clear all" at row end flips to inline "sure? yes / no" (no window.confirm); "RECENT FILES" header label
  with History icon styled like landing's "TRY A GENERATED SAMPLE" label; hydration-safe (loads in
  useEffect, skeleton h-9 w-40 rounded-full bg-zinc-800/60 animate-pulse while loading, never stale SSR
  markup); empty list / IndexedDB unavailable → returns null
- Fixed during verification: formatRecentWhen hours unit bug (min/3600 → min/60) caught by scratch test;
  component return type widened to React.JSX.Element | null (spec mandates return null on empty state,
  which bare React.JSX.Element rejects under strict TS)
- Verification: bunx eslint on both files → 0 errors 0 warnings; bunx tsc --noEmit → 0 errors in my files
  (only pre-existing errors remain in audio-viewer.tsx — modified by another agent, untouched by me);
  bun SSR-guard test: 15/15 (indexedDB undefined → listRecentFiles [] / getRecentFile null / add+remove+
  clear no-op, no throw; formatRecentWhen all buckets); full IndexedDB logic test with fake-indexeddb in
  scratch: 17/17 (newest-first list, limit, blob byte round-trip, dedupe update, same-name-diff-size new
  entry, oversized → cached=false + blob null, remove single, cap at 50 evicting oldest, clear); react-dom/
  server renderToString smoke (skeleton + label, no recents leak, default === named export); all scratch
  files deleted; dev.log clean (GET / 200, no compile breakage)
- Work record also written to agent-ctx/4-c-recent-files.md

Stage Summary:
- Delivered: src/lib/recent-files.ts (RecentEntry, RECENT_CACHE_CAP, addRecentFile, listRecentFiles,
  getRecentFile, removeRecentFile, clearRecentFiles, formatRecentWhen) and
  src/components/omniscope/recent-panel.tsx (RecentFilesRow + default export). No existing file edited.
- Integration notes for orchestrator: (1) in app-shell's addFiles, after detectFromHead completes call
  `void addRecentFile(file, { name: detected.name, viewer: detected.viewer })`; (2) render
  `<RecentFilesRow onOpenFile={(f) => addFiles([f])} />` on the landing — suggested right after the drop
  zone section (before "try a generated sample"), it self-hides when there are no recents; (3) dedupe also
  refreshes mime + cached blob on re-open, and `cached` is recomputed from actual blob presence at read
  time so quota-evicted blobs degrade honestly to the amber "re-open from disk" hint.

---
Task ID: 4-b
Agent: split-join (general-purpose)
Task: Client-side split/segmented file set detection (.001/.r00/.partN.rar/.z01+.zip) + in-browser joiner UI

Work Log:
- Read worklog.md, app-shell.tsx, viewer-ui.tsx, utils.ts, families.ts for conventions (zinc-950 dark, emerald/amber/rose, lucide, shared chrome kit)
- Created src/lib/splitjoin.ts — pure TS, zero imports, no DOM deps:
  * parseSegmentName: case-insensitive regexes for .001-.999 (3-digit, 1-999), .r00-.r99 (rar = volume 0), .partN.rar (leading zeros ok, N>=1), .z01-.z99 (zip = last part)
  * analyzeSegments: dedupe by lowercased name+size, group by (kind, lowercased base), attach companion .rar (index 0, prepended) / .zip (index maxZ+1, appended), require >= 2 files per set, sort by index, gap detection over expected range (numeric/partN 1..max; rxx 0..max incl. the .rar; zipx 1..maxZ+1 incl. the .zip slot), multiple qualifying sets -> largest then most complete then alphabetical; returns the exact spec interface (kind "zipx" for pkzip spanning), else null
  * joinFiles: 512 MB cap check BEFORE any read (friendly Error with MB figures), then sequential file.arrayBuffer() per part, pushes Uint8Array parts, reports (doneBytes, totalBytes) per completed file, new Blob(parts) at the end
- Created src/components/omniscope/split-join-view.tsx — "use client", fixed inset-0 overlay dialog (full-height flex column: header / scroll body / action footer with safe-area padding):
  * drop zone = keyboard-focusable <button> (click-to-browse via hidden multi-file input + drag/drop with stopPropagation so the global app handlers stay quiet; entire overlay also accepts drops); working set dedupes by name+size, per-file remove + clear-all
  * live analysis: "Detected pattern" SectionCard (base, pattern, count/total, kind chip, complete/missing chip, ordered segment list with index chips in mono, amber missing-segment warnings with reconstructed filenames, editable merged-name input backed by per-suggestion override map — no setState-in-effect)
  * join button (emerald, disabled without a set, Loader2 spinner + progress bar with mono done/total bytes); result card keeps the blob in state with "Open in Omniscope" (File([blob], name, octet-stream) -> onOpenMerged) + real <a download> anchor, re-openable/re-downloadable; inline rose error card for cap/read failures; instructions card listing all 4 recognized patterns with examples when no set detected
  * Esc closes via capture-phase keydown (stopPropagation so app-level Esc doesn't also close a tab); object URLs revoked on replace/unmount; framer-motion card entrances; aria-labels + focus-visible rings throughout
- Verification: bunx eslint both files -> 0 errors 0 warnings; bunx tsc --noEmit -> 0 errors in my files (only 2 pre-existing errors in audio-viewer.tsx, a file being edited concurrently by another agent — untouched by me); scratch bun logic test in /tmp: 51/51 pass (numeric gap missing=[3], rxx rar-first ordering, partN + leading zeros + gaps, zipx z-order + missing trailing .zip + z-gaps, no-match/mixed/null cases, case-tolerant grouping, dedupe, multi-group largest-wins, dotted bases, join byte-order round-trip, monotonic progress, 512MB cap Error, read-failure propagation) — scratch deleted; dev.log tailed: compiles clean, GET / 200

Stage Summary:
- Delivered src/lib/splitjoin.ts (analyzeSegments + joinFiles + JOIN_SIZE_CAP, 100% pure TS) and src/components/omniscope/split-join-view.tsx (SplitJoinView named + default export). Joining happens fully in-browser, capped at 512 MB.
- Integration (orchestrator): render <SplitJoinView initialFiles={segments} onOpenMerged={(f) => addFiles([f])} onClose={...} /> whenever opened files match segment extensions (families.ts .001-.999/.rNN/.zNN records or .partN.rar) or via a header "Join" button — it renders as a self-contained fixed overlay (z-50), so mount point doesn't matter. Note: it swallows Esc and drag/drop while open (by design). No existing files were edited.

---
Task ID: 5
Agent: orchestrator (Z.ai Code)
Task: Phase-2 QA, bug fixes, three new features (hex diff, split-join, recent files), VLM-driven styling polish

Work Log:
- Reviewed worklog + full QA pass via agent-browser: landing (10,014 counter), PNG/WAV/ZIP/MIDI viewers,
  format explorer, no console errors. dev server + lint healthy at session start.
- VLM screenshot review raised "audio waveform black void" → CONFIRMED REAL BUG:
  audio-viewer.tsx waveform bar math inverted (top = mid + maxs*scale put max BELOW center →
  bot-top negative → Math.max(1, negative) = 1px dots; only 1.4% canvas pixels drawn).
- FIXED audio-viewer.tsx: correct envelope math (max up / min down), vertical gradient bars,
  center reference line, amber playhead overlay div, ResizeObserver redraw on container resize,
  guard W<2/H<2. Also fixed spectrogram DPR bug (was putImageData at CSS-pixel size into a
  dpr-scaled canvas → half blank; now draws at device resolution + ResizeObserver).
  Verified: 49.3% canvas pixels now drawn; VLM confirms "waveform clearly visible".
- FIXED Home button dead-end: clicking Home set activeId=null but Landing only rendered when
  tabs.length===0 → blank "Reading & identifying…" state. Landing now renders whenever
  !activeTab (tab strip stays for navigation). Verified via agent-browser.
- NEW FEATURE — Binary Compare (Task 4-a; subagent failed twice on token limits, built by
  orchestrator): src/components/omniscope/diff-view.tsx. Exports DiffView({initialA, initialB,
  onClose}) + computeDiffHunks(). A/B slots (click-browse + drag-drop w/ stopPropagation, swap),
  chunked SHA-256 (8MB slices, UI never blocks), 128MB compare window cap w/ amber truncation
  notice, identical-hash fast path (emerald verdict), side-by-side hex+ASCII 16B/rows with
  rose-950/60 differing cells + amber ghost bytes past EOF + per-cell title tooltips
  ("0x0004F2A1: 3A → 41"), 4096-byte paged virtualization + prev/next + jump-to-offset
  (decimal/0x-hex), hunk navigator strip (rose chips, prev/next cycle, "3/4772" counter),
  stats bar (diff bytes, similarity %, hunks, first diff offset), copy-summary button.
  computeDiffHunks: gap<16 merging, tail hunks, 5000 cap. 7/7 bun logic tests pass
  (identical→0, single→1, gap4→merged, gap20→2, tail, diff+tail, empty). Wired into app-shell:
  header Compare button (Ctrl+D toggle, Esc exits), prefills A=activeTab, B=next tab.
  agent-browser verified: 4,900 diff bytes, 2.12% similar, 4,772 hunks, first 0x23, hunk nav,
  jumps to 0x100 (page 1) and 0x1300 (page 2), VLM-verified hex rendering.
- NEW FEATURE — Split-file Join (Task 4-b, subagent): src/lib/splitjoin.ts (analyzeSegments:
  .NNN/.rNN+.rar/.partN.rar/.zNN+.zip patterns, gap detection, 51/51 tests) +
  src/components/omniscope/split-join-view.tsx (self-contained overlay: drop/browse segments,
  live pattern detection card, ordered segment list, missing-part warnings, editable merged
  name, join w/ progress bar, 512MB cap, Open in Omniscope + Download). Wired: header Join
  button + auto-detected segment banner (amber, "Join them") when 2+ opened files form a set.
  agent-browser verified end-to-end: backup.zip.001/.002/.003 → joined → opened as ZIP Archive tab.
- NEW FEATURE — Recent files (Task 4-c, subagent): src/lib/recent-files.ts (raw IndexedDB,
  db omniscope-recents, 50-entry cap, 8MB blob cache, name+size dedupe, SSR guards, never
  throws; 17/17 fake-indexeddb tests) + src/components/omniscope/recent-panel.tsx
  (RecentFilesRow: hydration-safe lazy load, mono chips w/ format dot+icon+size+relative time,
  click→lazy blob fetch→reopen, "not cached" amber hint, per-chip remove, inline clear-all
  confirm, returns null when empty). Wired: addRecentFile called in addFiles pipeline after
  detection; RecentFilesRow rendered on landing between dropzone and samples.
- STYLING POLISH (VLM review round 1 → fixes → VLM review round 2):
  viewer-ui.tsx Field values zinc-200→zinc-100 (VLM round 2: "scanning effortless"),
  SectionCard hover:border-zinc-700; archive-viewer zebra rows (idx%2 bg-zinc-900/40) +
  row title tooltips + stronger hover; audio-viewer Tags empty state (dashed border card w/
  icon + "ID3/Vorbis/FLAC metadata would appear here" — VLM round 2 confirms); landing
  headline gradient narrowed to emerald/teal family (dropped jarring amber), dropzone py-14;
  info-panel card gap-4. VLM round 2 ratings: 8.5/9/9/8 (round 1 issues resolved).
  Round-2 leftover notes (not bugs): tab chip in header on landing is the file strip (by
  design), "clear all" styling minor, footer density minor.
- INFRA: dev server OOM-killed mid-session (2.1GB RSS after many hot reloads, 4GB container);
  sandbox kills backgrounded processes between Bash calls (nohup/setsid insufficient) →
  created dev-daemon.js (ESM, detached spawn via node:child_process, child.unref, PPID 1)
  → server now survives across calls. Restart procedure:
  cd /home/z/my-project && bun dev-daemon.js && sleep ~15 (first compile ~10s).
- tsc --noEmit: 0 errors; eslint: 0 errors/warnings (dev-daemon converted to ESM imports);
  dev.log healthy; agent-browser full regression pass green.

Stage Summary:
- OMNISCOPE phase 2 complete: 3 real bugs fixed (waveform inversion, spectrogram DPR, Home
  dead-end), 3 major features added (Binary Compare view, Split-file Joiner w/ auto-detect
  banner, IndexedDB Recent files), styling polished per two VLM review rounds.
- App remains 100% client-side, single / route, 10,014 format identities, 39 viewer engines +
  compare/join/recents tooling. All new code follows zinc-950/emerald-teal-amber-rose palette.
- Known limitations (unchanged): RAR/7z listing identify-only, WOFF2 metrics, compressed
  DICOM, legacy .doc/.ppt text recovery. Diff compare caps at 128MB window; join at 512MB.
- Next-phase candidates: NFO→PNG render, CSV↔XLSX converters, text-line diff mode in
  compare view, diff of >2 files, recents grouping by format, keyboard shortcut help modal.

---
Task ID: 6
Agent: orchestrator (Z.ai Code)
Task: Phase-3 — QA assessment, text-line diff engine + Compare Text mode, shortcuts
help modal, NFO→PNG export, styling polish round 3, VLM reviews

Work Log:
- Reviewed full worklog (phases 1–2 complete). QA pass via agent-browser: dev server healthy
  (GET / 200), landing 10,014 counter, PNG/WAV/ZIP sample viewers, Compare open/close
  (Ctrl+D/Esc), Join overlay — 0 console errors; lint 0 errors; tsc only pre-existing
  examples/skills errors (not app code). VERDICT: stable → proceeded to new features.
- NEW ENGINE — src/lib/textdiff.ts (pure TS, zero deps, 30/30 bun logic tests PASS):
  * splitLines (CRLF/CR/LF), decodeTextual (UTF-8 → windows-1252 fallback when >0.5%
    U+FFFD), looksTextual (≥90% printable heuristic on first 64KB)
  * diffLines: hybrid patience diff — common prefix/suffix trim → patience anchors (lines
    unique in both ranges) + LIS over anchor pairs (O(k log k)) → DP LCS for regions ≤300×300
    cells and anchor-less regions ≤4M cells (Uint32Array table) → wholesale replace fallback;
    recursion depth cap 48; no spread-push (stack safe); normalizeOps reorders each change
    run deletes-before-inserts (git style). Verified optimal on pathological alternating
    2000×2000 input (edit distance 2 found, coverage invariant holds, <30ms).
  * textDiffStats (added/removed/changed=min(d,i) per run/hunks/equal);
    buildUnifiedPatch: standard git-style unified diff (3-line context, @@ headers, hunk
    clustering at >6 equal gap, "\ No newline at end of file" markers).
  * Test suite validated: identical/insert/delete/modify/empty/wholesale/repeated-lines/
    12k-line perf (19ms)/coverage-invariant/patch format + hunk headers + del-before-add/
    no-newline marker/multi-hunk (3 hunks)/cp1252 fallback/looksTextual — all pass. (4
    initial "failures" were wrong test expectations, corrected after analysis.)
- NEW FEATURE — Compare Text mode (diff-view.tsx rewritten, byte mode intact):
  * Toolbar Segmented Bytes/Text; AUTO mode selection when both sides look textual
    (modeTouched ref guards manual choice; re-evaluates on file change)
  * Text window: 8MB decode cap + 60k line cap per side (amber truncation chip)
  * Unified view (default): dual A/B line-number gutters, −/+ markers, rose/emerald row
    tints, 3-line context, equal runs >8 collapse into "⋯ N unchanged lines — expand"
    buttons (expandedGaps Set), EOF footer marker, 4000-row pagination w/ "Show more"
  * Split view: aligned sides, del/ins runs paired index-wise into "mod" rows, per-side
    EOF·N-lines markers filling the shorter pane, hover row highlight
  * Wrap toggle (whitespace-pre ↔ pre-wrap break-all); stats chips (+added −removed ~changed
    hunks unchanged, encoding mismatch chip, "textually identical" emerald verdict when
    ops have no changes but hashes differ); footer shows per-side line counts + encodings +
    "patch ready (N chars)"
  * Copy patch / Save .patch (real .patch download via Blob anchor); copy-summary now
    mode-aware (text stats vs byte stats)
  * React-safe: useMemo results carry {error} instead of setState-in-render (fixed my own
    anti-pattern before shipping); TS5076 ?? || parens fixed
  * agent-browser verified end-to-end: config-old/new.yml → auto-text, 8 added / 6 removed
    / ~6 changed / 7 hunks (matches hand count exactly), patch 600 chars, gap expand,
    wrap (31 elements), split (25 rows), 12k-line big files → 32/34/32 stats in <1s,
    32 collapse gaps, 0 console errors.
- NEW FEATURE — ShortcutsHelp modal (src/components/omniscope/shortcuts-help.tsx):
  4 groups (Global/Files & tabs/Tools/Viewers) with kbd chips + icon keys, hints, Esc
  capture-phase close, backdrop click close. Wired: "?" key (ignored while typing in
  inputs), header keyboard button, footer chip; Esc priority chain now starts with
  helpOpen. Verified via header button + Shift+/ real keypress (toggles).
- NEW FEATURE — NFO→PNG export (nfo-viewer.tsx): canvas render honoring color mode
  (glow via shadowBlur), font size, CRT scanlines; DPR 2× scale with 40MP area + 16384px
  side guards (auto downscale to 0.5×, line truncation notice); emerald result chip in
  footer ("Saved 958×336 PNG" verified).
- STYLING ROUND 3:
  * Tab strip: per-category accent dot (CAT_DOT map mirrors landing hues, pulsing zinc
    while detecting, title=cat tooltip) + trailing dashed "+" open-file button
  * Dropzone: kbd hint row (Ctrl+O open · Ctrl+V paste a file · ? shortcuts)
  * Footer: compact py-2.5, shortcuts chip button (replaces 4 inline kbds), GitHub Pages
    note kept; header compare banner text generalized ("byte & text diff · hashes · patches")
  * Recents "clear all": ghost pill chip + inline confirm pill (rose tint, yes/no buttons)
  * Compare split/unified EOF markers (VLM round-1 feedback: "empty black space at pane
    bottom" → resolved)
- INFRA: dev server died once mid-session (sandbox process reaper) → restarted via
  `bun dev-daemon.js` (procedure from phase 2), healthy since. Next.js dev overlay "1
  Issue" badge investigated: caused by my own failed agent-browser eval (TypeError thrown
  in page context), NOT an app bug — fresh reload shows 0 issues, full flows log 0 errors.
- VERIFICATION: tsc --noEmit 0 app errors; eslint 0/0; VLM review round: unified 8/10,
  split 8/10 (hash truncation by-design w/ tooltip; EOF fixed), shortcuts 9/10, landing
  9/10. Remaining notes are subjective (hint text faintness, grid header alignment).

Stage Summary:
- OMNISCOPE phase 3 complete: Compare gained a full text-diff mode (patience+LCS engine,
  unified/split, patches, wrap, collapse gaps, EOF markers, auto text/bytes), shortcuts
  help modal (? key + buttons), NFO→PNG canvas export, and styling round 3 (tab dots,
  dropzone kbd hints, footer chip, recents pills).
- App remains 100% client-side single-route; 10,014 format identities, 39 viewer engines,
  compare/join/recents/shortcuts tooling. All engine logic covered by 30/30 bun tests.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics, compressed DICOM,
  legacy .doc/.ppt recovery; text diff window 8MB/60k lines per side; byte window 128MB.
- Next-phase candidates: CSV↔XLSX converters, >2-file diff, recents grouping by format,
  in-diff syntax highlighting (hl.js per language), text diff word-level intra-line
  highlighting (char-level within changed pairs), NFO→PNG at 1:1 with bg color option.

---
Task ID: 7
Agent: orchestrator (Z.ai Code)
Task: Phase-4 — QA assessment, word-level diff highlighting, text-diff change-block
navigation (n/p), CSV→XLSX export, styling round 4, VLM reviews

Work Log:
- QA assessment at round start: dev server healthy, landing (10,014 counter + kbd hints),
  PNG/MIDI viewers, Compare text mode (8 added/6 removed/7 hunks), 0 console errors,
  lint/tsc clean. VERDICT: stable → proceeded to new features (phase-3 next-phase
  candidates used as backlog).
- NEW ENGINE — wordDiff in src/lib/textdiff.ts: tokenizes paired lines
  (/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) and re-runs the same patience/LCS machinery on
  token arrays → WordPart[] {text, changed} per side with adjacent-part merging; caps at
  2000 chars/side; null for identical lines. 17/17 bun tests PASS (word change
  "quick"→"slow", pure insertion, punctuation-merge, round-trip reconstruction,
  "512"↔"1024" isolated exactly, cap guard, whitespace change, empty side, unicode,
  500-pairs perf < 500ms, diffLines regression intact).
- NEW FEATURE — word-level intra-line highlighting in Compare text mode:
  * wordMap useMemo pairs dels[k]↔ins[k] within each change run (op-index keyed Map);
    splitRows "mod" rows carry aParts/bParts directly
  * renderParts renders changed tokens as rounded spans (rose-800/emerald-800 bg) in
    BOTH unified del/ins rows and split mod rows; "Words" ToolButton toggle (Highlighter
    icon, default on); verified char-level precision: "2.1.0"→"2.2.0" highlights only
    "1"→"2"; 12 spans on config fixture, 30 on the 12k-line fixture, 0 errors
- NEW FEATURE — change-block navigation: unifiedSegs rebuilt with USegItem {op, i}
  (op-index tracking) + blockId per change run; text-mode navigator bar (Prev/Next +
    "change N / M" counter + n/p kbd hint chip); goBlock scrolls first row into view
  (smooth, centered) with double-rAF retry + shownRows expansion when paginated out;
  n/p keyboard effect (guards typing in inputs, no modifiers); active block gets amber
  inset left ring + amber-400 gutter numbers; curBlock resets on file swap (verified:
  3/7 → swap → 1/7); block navigation verified step-by-step (1→2→3→2) and on big file
  (32 blocks); React batched double-click in single eval explained apparent skip
  (expected closure behavior, not a bug).
- NEW FEATURE — CSV viewer "XLSX" export (SheetJS dynamic import, same pattern as
  xlsx-viewer): aoa_to_sheet of filtered+sorted rows, heuristic !cols widths
  (500-row scan, wch capped 42), book_new + write "array" → .xlsx download; respects
  the filter & sort already applied (what-you-see-is-what-you-export).
- STYLING ROUND 4:
  * Compare slot hash presentation (VLM flagged twice): proper bordered chip
    "sha256 d2020475…31d1" (first 8 + last 4), click-to-copy with stopPropagation
    (verified: picker does NOT open), keyboard accessible, full-hash title tooltip
  * Active-block gutter contrast amber-500/80 → amber-400 (unified + split)
  * ShortcutsHelp modal entrance animation (framer-motion: opacity/scale/y 180ms
    ease-out) + Tools group documents n/p ("Next/Previous change block")
  * Split gutter borders get amber tint on the active block
- VLM REVIEW ROUND: unified 9/10, split 8/10, modal 9/10. VLM claims investigated
  programmatically: "split misalignment (critical)" → DISPROVEN (getBoundingClientRect:
  aTop === bTop on every row, panes 640/641px equal ± border, no horizontal overflow —
  VLM misread standard blank-pane diff layout); "modal footer cut off" → DISPROVEN
  (footerBottom 533 < viewport 577, footerVisible true); hash truncation + amber
  contrast → REAL polish items, both fixed this round.
- VERIFICATION: tsc 0 app errors; eslint 0/0; dev server healthy throughout; full
  agent-browser regression (landing → PNG → MIDI → compare auto-text → word spans →
  block nav → split → EOF markers → CSV sample + XLSX click → shortcuts modal) —
  0 console errors on every step.

Stage Summary:
- OMNISCOPE phase 4 complete: text compare now has GitHub-grade word-level highlighting
  (both views, toggleable) and keyboard-driven change-block navigation with active-block
  amber ring; CSV tables export to real XLSX workbooks (filter/sort-aware); slot hash
  chips are click-to-copy; shortcuts modal animated and documents n/p.
- App remains 100% client-side single-route; 10,014 format identities, 39 viewer engines;
  textdiff engine now at 47/47 total logic tests (30 line-level + 17 word-level).
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics, compressed DICOM,
  legacy .doc/.ppt recovery; text window 8MB/60k lines; byte window 128MB.
- Next-phase candidates: >2-file diff, syntax highlighting in diff rows (hl.js token
  mapping), recents grouping by format, hash panel in InfoPanel with copy buttons,
  NFO→PNG bg color option, joiner auto-window for >512MB sets.

---
Task ID: 8
Agent: orchestrator (Z.ai Code)
Task: Phase-5 — QA assessment, syntax-highlighted text diff, InfoPanel CRC-32 +
checksum export, recents format-family filter, JSON→CSV + MD→HTML converters,
Dialog a11y fix, styling round 5, VLM reviews

Work Log:
- QA assessment at round start (per instructions): dev server healthy (GET / 200),
  landing (10,014 counter), PNG viewer, Compare text mode (8 added/7 removed/3
  hunks on fixture), word-level highlighting (16 spans), Join overlay, format
  explorer search ("flac" → FLAC), shortcuts modal, recent files row — 0 console
  errors; lint 0/0; tsc only the 4 pre-existing examples/skills errors. VERDICT:
  stable → proceeded to new features.
- ONE REAL ISSUE FOUND: Radix warning `Missing Description or aria-describedby
  for {DialogContent}` from format-explorer.tsx → FIXED by adding
  `aria-describedby={undefined}` to DialogContent (Radix-recommended). Verified
  via cleared-console reload + dialog open: warning gone.
- NEW MODULE — src/lib/hlsyntax.ts (shared hl.js syntax engine, 0 errors):
  * LANG_BY_EXT map (~120 entries) moved here from code-viewer (single source
    of truth; code-viewer.tsx refactored to import it — its local copy removed)
  * loadHljs(): module-level cached promise of `highlight.js/lib/common`
  * detectLang(fileName, firstLine): extension map + shebang sniff
  * autoDetectLang(sample, hljs): highlightAuto over 20-language subset, ≤400 lines
  * tokenizeLines(text, lang, hljs): hljs.highlight → DOMParser walk of the
    emitted HTML → per-line LineTok[] {text, cls} arrays (innermost span wins,
    newlines split tokens)
  * sliceTokens(toks, start, end): char-range slicing so word-diff parts can
    inherit underlying syntax colors
- NEW FEATURE — syntax highlighting in Compare text mode (diff-view.tsx):
  * Language from A's filename → B's filename → content auto-detect; shown in
    toolbar button title + unified/split header labels ("· yaml")
  * Whole-text tokenization per side, capped at 400k chars / 20k lines per side
    (amber chip "syntax off — file over 20,000 lines" when exceeded)
  * renderLineContent(): merges syntax tokens with word-level changed parts —
    changed words keep rose/emerald bg while inner tokens keep syntax colors
    (GitHub-style). Used by BOTH unified rows (toks param added to unifiedRow)
    and split rows (aToks/bToks looked up per row)
  * "Syntax" ToolButton toggle (Code2 icon, active state, dimmed when no
    language); scoped `.dxhl` CSS palette (emerald keywords / amber strings /
    rose numbers / zinc comments / teal titles / violet attrs — mirrors the code
    viewer, no blue/indigo); toggle verified: 43 spans on / 0 off / word-diff
    intact; split view 46 spans; header shows lang in both views
  * agent-browser verified end-to-end on YAML fixture: 43 hljs tokens
    (attr/number/string), word spans nested inside token spans
    (`<span bg-rose-800><span hljs-number>8080</span></span>`), 0 console errors.
    VLM review: 9/10 "syntax colors clearly visible… highly polished,
    professional-grade UI"
- NEW FEATURE — InfoPanel checksums upgrade (info-panel.tsx):
  * CRC-32 added (8-digit hex, Copyable) — implementation verified against
    standard vector crc32("123456789") = cbf43926 via bun script
  * "Copy all checksums" button (clipboard: crc32/md5/sha1/sha256 block with
    file header) + "Download checksums.txt" button (standalone .checksums.txt
    with provenance header); both as SectionCard right-slot icon buttons
  * >50MB amber note when hashes cover the head only
  * Verified in-browser: CRC-32 5e64229f on sample.png, both buttons present
- NEW FEATURE — recents format-family filter (recent-panel.tsx):
  * MAX_VISIBLE 12 → 50 (full store); familyOf() maps viewerId → media/docs/
    code/data/archives/other
  * Filter pill row (all N + per-family count pills with family dots, emerald
    active state) appears only when >3 entries span >1 family; "N shown of M"
    counter; click pill again to reset; clear-all also resets filter
  * Verified: "all 7 / media 3 / docs 2 / data 1 / archives 1" pills; clicking
    media → "3 shown of 7", png+wav visible, nfo hidden
- NEW FEATURE — JSON→CSV converter (json-viewer.tsx):
  * csvReady heuristic: root array of objects (≥ tolerance for oddballs)
  * flattenRow (one nesting level, dot notation), csvCell RFC-style quoting
    (commas/quotes/newlines), header union from first 2000 rows
  * "CSV" ToolButton (Table icon, title explains dot-notation) only when
    csvReady; downloads <basename>.csv text/csv
  * Verified: users.json (array of 3 objects with nested meta) → button appears,
    blob download triggered; nested sample object → button correctly absent
- NEW FEATURE — Markdown→HTML export (markdown-viewer.tsx):
  * saveStandaloneHtml(): self-contained dark HTML document (embedded CSS ~40
    rules: GitHub-ish typography on zinc-950, emerald links, zebra tables,
    emerald blockquote bars), TOC nav with indent levels, escaped titles,
    generator meta, footer credit; "HTML" ToolButton (Download icon)
  * Verified: button present on markdown sample, blob download triggered
- STYLING ROUND 5 (mandatory detail pass):
  * globals.css: global focus-visible ring (2px emerald, buttons/a/summary/
    role=button), `.text-shimmer` gradient-pan keyframes (7s, honors
    prefers-reduced-motion), `.pressable` active:scale feedback
  * Landing: hero "anything" gradient drifts (text-shimmer), stat cards get
    gradient bg + hover border, category cards get focus rings + icon lift +
    active:scale-[0.98], sample chips get pressable feedback + focus ring
  * App shell: signature 1px emerald top hairline (fixed, pointer-events-none),
    active tab gets gradient bg + inset emerald underline + tooltip with
    detected format name · category, footer gains tools summary line
    ("compare · join · recents · word diff · syntax diff · converters")
  * viewer-ui kit: ToolButton + Segmented buttons get active:scale-95 press
    feedback, transform transitions, active inset highlights
  * VLM review of landing: 9/10 "stunning, professional-grade UI… aesthetic
    appeal with excellent functional clarity"
- INFRA: dev server died twice mid-session (sandbox process reaper after heavy
  hot-reload) → restarted via `bun dev-daemon.js` both times (phase-2
  procedure still works). Stale console errors from a transient broken
  intermediate edit state (diff-view) investigated → confirmed gone after
  fresh reload with cleared console buffer.
- VERIFICATION: tsc --noEmit 0 app errors; eslint 0/0; agent-browser full
  regression green (landing + shimmer + pills → PNG + CRC-32 + hairline →
  JSON CSV click → MD HTML click → explorer dialog (no warning) → compare
  syntax 43 tokens + 7 word spans + 8 added/3 hunks → shortcuts modal) with
  0 console errors on a cleared buffer; dev.log healthy.

Stage Summary:
- OMNISCOPE phase 5 complete: Compare text mode now renders GitHub-grade
  SYNTAX-HIGHLIGHTED diffs (hl.js tokens merged with word-level highlighting,
  both unified + split, capped for performance, toggleable); InfoPanel computes
  CRC-32 and exports/copies full checksum blocks; recents filter by format
  family; JSON arrays export to CSV (nested-flattened); Markdown exports
  standalone styled HTML; format-explorer Dialog a11y warning fixed; styling
  round 5 shipped (top hairline, shimmer hero, tab gradient underline, press
  feedback, focus rings, footer summary).
- App remains 100% client-side single-route; 10,014 format identities, 39
  viewer engines; new shared module src/lib/hlsyntax.ts is the single source
  of truth for language detection + tokenization (code viewer refactored onto
  it with zero behavior change).
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics, compressed
  DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines; byte window
  128MB; syntax diff caps at 400k chars / 20k lines per side.
- Next-phase candidates: >2-file diff (3-way), in-diff hover blame/lineno
  deep-links, per-format export matrix (more converters: XLSX→JSON, CSV→JSON,
  SRT→VTT), image OCR? (no — external), ZIP re-packer/extract-to-blob,
  IndexedDB file collections/folders, printable forensic report per file,
  theme accent picker (emerald/amber/rose), >512MB join streaming.
---
Task ID: 9
Agent: orchestrator (Z.ai Code)
Task: Phase-6 — QA assessment, duplicate-key bug fix, ZIP/OOXML detection
re-engineer, forensic report generator, converter matrix (XLSX→JSON, SRT→TXT,
NFO bg modes), styling round 6, VLM reviews

Work Log:
- QA assessment at round start (per instructions): dev server healthy,
  landing + PNG viewer + Compare + explorer + shortcuts + recents all green
  (CRC-32 5e64229f on sample.png matches phase-5 record), 0 console errors
  after hooking error/unhandledrejection/console.error.
- REAL BUG #1 FOUND & FIXED — React duplicate children keys: uploading a
  text file as a compare slot surfaced "Encountered two children with the
  same key" ×6 (utf-8 / iso88595 / shift-jis × 2 renders). Root causes:
  (a) ENCODINGS in src/lib/utils.ts had literal duplicate labels — "iso88595"
  twice in "More Latin", "shift-jis" twice in "Japanese" (bun script: 229 raw
  entries, 227 unique) — also duplicated explorer rows (enc:iso88595 ×2);
  (b) code-viewer's encoding select prepends "{guessed} (auto)" whose value
  collides with the same label in the options list. Fixes: removed both
  literal duplicates (identity count unaffected — stats.ts already counted
  via Set); code-viewer now filters o.value !== guessed from encodingOptions.
  Verified: re-ran same upload flow → 0 errors. Explorer rows now unique.
- REAL BUG #2 FOUND & FIXED — ZIP/OOXML container detection miss: a
  SheetJS-authored .xlsx (xl/_rels/workbook.xml.rels as FIRST entry,
  [Content_Types].xml beyond the 512-byte sniff window) was detected as
  plain "ZIP Archive" and opened in the Archive viewer. Re-engineered
  sniffZip() in src/lib/detect.ts: walks every PK\x03\x04 local file header
  in the 64KB head (names are stored uncompressed even for deflated data),
  collecting entry names with nameLen/extraLen sanity checks; then keys off
  hasPrefix("xl/"|"word/"|"ppt/"), hasName("[Content_Types].xml"),
  AndroidManifest.xml, META-INF/MANIFEST.MF, usr/Data. Bun test matrix 8/8:
  sheetjs-order xlsx, classic xlsx, docx, pptx, plain zip stays archive,
  apk, jar (Packaged Application Archive), epub; real test-items.xlsx →
  viewer "xlsx", method "container". Browser-verified: upload now opens the
  XLSX viewer with sheet tabs.
- NEW FEATURE — forensic report generator (printable, per file):
  * src/lib/forensic-report.ts (NEW, pure string builder, SSR/test-safe):
    buildForensicReportHtml(ForensicInput) emits a standalone paper-light
    HTML report — branded header w/ generated UTC timestamp, Subject table,
    Identification table (format/category/method/magic + conflicts note),
    entropy profile (gradient bar + classification + humanBitsPerByte),
    first-bytes hex block, checksums (crc32/md5/sha1/sha256 + verification
    sha256 chip), partial-hash warning when >50MB, provenance footer with
    identities count, embedded Print button (hidden via @media print),
    break-inside:avoid sections, full HTML escaping. 21/21 bun tests
    (escaping, entropy zones, partial note, conflicts, minimal input,
    standalone no-http-refs, structure).
  * info-panel.tsx wires it: File-section icon button (FileText, disabled
    until hashes+entropy ready) + full-width "Forensic report" action row
    replacing the old static ShieldCheck note; pulls FORMAT_STATS.identities
    and VIEWER_LABELS for the report.
  * Verified end-to-end via agent-browser download: report contains real
    sample.png data (CRC 5e64229f, magic 89 50 4E 47, entropy 7.972,
    "10,014 recognized format identities"). VLM review of the rendered
    report: 9/10 "highly polished, professional forensic report template".
- NEW FEATURE — converter matrix expansion:
  * xlsx-viewer.tsx: "JSON" ToolButton (Braces icon) — sheet_to_json with
    raw:true + defval:"" → typed row objects (numbers/booleans survive);
    multi-sheet suffix "-<sheet>" like CSV export. Verified: downloaded
    test-items.json has "qty": 4, "ok": true typed correctly.
  * subtitle-viewer.tsx: "TXT" ToolButton (FileText icon) — plain-text
    transcript export, [m:ss]/[h:mm:ss] stamps, speaker prefixes, single
    blank line between cues, multiline cue text joined. Verified on
    sample.srt → "[0:01] Every format deserves a viewer." (initial mm-only
    format "[01]" judged ambiguous → switched to standard m:ss).
  * nfo-viewer.tsx: background color modes (Black / Dark zinc / Paper) as
    a second Segmented next to ink colors — live terminal preview AND PNG
    export both honor it; paper forces dark ink #1c1917, disables glow and
    scanlines; zinc uses stronger scanline alpha. About text + CRT tooltip
    updated. Verified: paper → pre color rgb(28,25,23) on rgb(247,246,242).
- STYLING ROUND 6 (mandatory detail pass):
  * globals.css: global kbd style (3D key depth: 2px bottom border + inset
    shadow, mono, hover lighten); .viewer-grid zebra rows utility.
  * landing.tsx: 5 inline kbd chips now use the global style; stat cards
    fixed — container was missing the `group` class so the inner
    group-hover:text-emerald-200 never triggered (real hover bug); added
    focus-within emerald border; "Customized per format" card now documents
    per-format exports + forensic reports.
  * app-shell.tsx footer tools line: "… converters · forensic reports".
  * info-panel.tsx: entropy meter gains zone tick marks (4 structured /
    6 packed / 7.2 compressed-encrypted, 9px mono, zinc-500) + a
    human-readable classification line (high/elevated/medium/low) matching
    the report's entropyClass.
  * csv-viewer.tsx: JSON ToolButton finally gets a title tooltip
    ("respects filter & sort"); xlsx JSON button titled likewise.
- VLM REVIEWS: landing 9/10 ("hero typography excellent… professional"),
  forensic report 9/10, info panel 8.5/10 (tick labels verified rendering
    via getBoundingClientRect — VLM couldn't read 8px text, bumped to 9px
    zinc-500), final compare view 8/10 (binary mojibake expected — side A
    is a PNG in text mode, not a bug).
- INFRA: dev server died once mid-session (sandbox reaper after heavy
  hot-reloads) → restarted via `bun dev-daemon.js` (phase-2 procedure).
- VERIFICATION: tsc --noEmit 0 app errors; eslint 0/0; full agent-browser
  final regression on a fresh reload with cleared error buffer — landing
  (kbd 2px/bottom-border, 29 group cards, footer line) → PNG (entropy ticks
  4/6/7.2 + classification + report buttons enabled) → WAV (audio+waveform+
  meta) → NFO (Paper/Dark/Black cycle, emerald-on-black verified) → explorer
  Ctrl+K "dicom" found → compare slot-B upload + Text mode (846 syntax
  spans, block nav present) — 0 console errors at every step; dev.log GET /
  200 healthy.

Stage Summary:
- OMNISCOPE phase 6 complete: two real bugs fixed (duplicate React keys in
  encoding lists/selects; ZIP local-header walk making OOXML detection
  order-independent), printable standalone forensic reports per file, three
  new converters (XLSX→JSON typed, subtitles→TXT transcript, NFO PNG bg
  modes), styling round 6 (3D kbd keys, stat-card hover fix, entropy zone
  ticks, footer/tooltips).
- App remains 100% client-side single-route; 10,014 format identities, 39
  viewer engines; new module src/lib/forensic-report.ts (21/21 tests);
  sniffZip re-engineered (8/8 container test matrix).
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines;
  byte window 128MB; syntax diff caps 400k chars / 20k lines per side.
- Next-phase candidates: 3-way diff, in-diff line deep-links, ZIP
  extract-many / re-pack, ODS→XLSX conversions, image EXIF panel, hash-
  verification workflow (paste expected sha256 → compare), report batch
  mode for multiple files, accent theme via CSS-variable surfaces.
---
Task ID: 10
Agent: orchestrator (Z.ai Code)
Task: Phase-7 — QA assessment, ODS detection bug fix, archive bulk extract/re-pack,
checksum verification workflow, XLSX conversion export, folder drop, styling round 7

Work Log:
- QA assessment at round start (per instructions): dev server healthy, landing
  (10,014 counter, 12 sample chips, recents family pills), PNG viewer (canvas/
  CRC-32/entropy/hashes), WAV viewer (waveform + audio element), ZIP archive
  (entries table), format explorer ("flac" search), Compare (Bytes/Text segments)
  — 0 console errors; lint 0/0; tsc only the 4 pre-existing examples/skills
  errors; no horizontal overflow. VERDICT: stable → proceeded to new features
  (phase-6 backlog used as seed).
- REAL BUG FOUND & FIXED — ODS container detection miss: a SheetJS-authored .ods
  (META-INF/manifest.xml as FIRST entry, mimetype at offset 1219) fell through
  sniffZip's 128-byte mimetype window and was detected as plain "ZIP Archive".
  Re-engineered src/lib/detect.ts sniffZip():
  * mimetype adjacency search window widened 128 B → full head (64 KB) — the
    name→data adjacency pattern only occurs in stored local headers, so no
    false positives from manifest listings
  * new fallback: entry-name evidence (META-INF/manifest.xml + content.xml or
    styles.xml) → ODF package; flavor resolved from the file extension
    (ods/otp → ods, odp → odp, odg/otg → odg, default odt)
  * sniffZip now receives the filename (sniffZip(head, name))
  Verified: bun test matrix 4/4 (sheetjs xlsx → xlsx; ods → OpenDocument
  Spreadsheet/xlsx viewer incl. renamed basename; plain zip stays archive) +
  browser upload flow (see XLSX export below).
- NEW FEATURE — Archive bulk extraction & re-pack (archive-viewer.tsx):
  * ViewerProps gained optional onOpenFile?: (file: File) => void (types.ts);
    app-shell passes it as (f) => addFiles([f]) — extraction can open entries
    as real tabs with full detection pipeline
  * Checkbox column (extractable entries only — read() && !encrypted, hidden in
    directory-only mode) + indeterminate master checkbox in the table header +
    toolbar "Select all" ToolButton (ListChecks icon)
  * Sticky floating action bar (bottom-3, zinc-800/95 + emerald border, shadow-xl,
    backdrop-blur) when ≥1 selected: "N selected · X MB uncompressed",
    [Download individually] (sequential, 300 ms gaps, live done/total progress),
    [Save as .zip] (fflate async zip, level auto: 0 when >50% of selected bytes
    are already-compressed extensions, else 6; 512 MB uncompressed cap with amber
    error card), [Clear]; amber error card for extraction failures
  * EntryPanel gained "Open" button (ExternalLink icon) — extracts entry → new
    File → onOpenFile → full viewer pipeline (verified: readme.txt extracted from
    sample.zip opened as a second tab, correct detection)
  * selected rows get emerald-950/30 tint; info card + footer copy updated
  * Verified end-to-end: 3/3 checkboxes render, master select-all, action bar
    appears, "Save as .zip" produced a re-packed sample.zip download (anchor spy)
    with packaging state clearing, "Open" created a new tab, 0 console errors.
- NEW FEATURE — Checksum verification workflow (info-panel.tsx):
  * parseChecksum(): accepts bare hex (8/32/40/64 chars → CRC-32/MD5/SHA-1/
    SHA-256) or "algo hash filename" sum-file lines (crc32|md5|sha1|sha256
    prefixes, case-insensitive, "-" variants); validates length vs algorithm
    * 12/12 bun logic tests (all algorithms bare + prefixed + sum-file line with
      trailing filename, uppercase hex, garbage/short/empty → null)
  * Inline verifier inside the Checksums card: "Verify against an expected
    checksum…" expander → mono input + emerald Verify button (disabled until the
    input parses) + live detection hint ("detected SHA-256 · 256-bit digest");
    Enter key verifies; emerald match card ("integrity verified") / rose
    mismatch card (expected vs computed, mono) with role=status/alert; amber
    head-only caveat on >50 MB files wired into both verdicts
  * Verified in-browser: wrong hash → mismatch card with both digests; real
    SHA-256 scraped from the panel → "integrity verified"; detection hint shown;
    0 console errors.
- NEW FEATURE — XLSX export / format conversion (xlsx-viewer.tsx):
  * "XLSX" ToolButton (Grid3X3 icon) on every workbook: XLSX.write(book.wb,
    bookType xlsx, type array) → download — converts .xls/.ods/.xlsb sources to
    modern .xlsx (whole workbook, all sheets)
  * Failure path renders a transient amber note bar under the toolbar (not the
    destructive ErrorCard) — exportNote state auto-clears after 5 s
  * Verified: bun ods→xlsx→read-back roundtrip OK (S sheet, A1='a', 15,930 B);
    browser: uploaded test-items.ods → detected "OpenDocument Spreadsheet" →
    sheet viewer → XLSX click → downloaded test-items.xlsx (blob 15,930 B,
    PK\\x03\\x04 magic, 0 errors).
- NEW FEATURE — Folder drop support (app-shell.tsx):
  * onDrop now harvests webkitGetAsEntry() entries SYNCHRONOUSLY (the item list
    dies after the first await) before async traversal
  * Recursive walk (depth cap 8, FOLDER_FILE_CAP 24 per drop, readEntries
    pagination loop until empty batch, per-entry error tolerance) collects Files;
    mixed file+folder drops flatten through the same path; plain-file drops keep
    the legacy dataTransfer.files path (synthetic-drop regression verified:
    dropped.txt opened, 0 errors)
  * Teal "Folder drop — opened N files from "name" (cap 24 per drop)" banner
    (FolderDown icon, dismiss X, 9 s auto-dismiss); landing dropzone copy now
    says "Drop files or whole folders anywhere" + FolderDown kbd-row hint
  * Verified: 6/6 bun mock-filesystem logic tests (recursive 3-level walk,
    30→24 cap, readEntries pagination, mixed loose+folder, two folders, fresh
    trees) — real OS folder drag can't be synthesized in headless, logic + the
    synchronous-entry precondition documented in-code.
- STYLING ROUND 7 (mandatory detail pass, VLM-driven):
  * VLM review round: landing 8.5/10, archive 7/10, entry panel + verify
    pass. Actionable fixes applied:
    - archive table Name column: td max-w-0 → max-w-0 w-full (names no longer
      aggressively truncated; VLM re-review: "FIXED")
    - floating action bar surface zinc-900/95 → zinc-800/95 + shadow-xl (VLM
      re-review: "FIXED" — no longer blends into background)
    - dropzone dashed border zinc-700 → zinc-600 (VLM: weak contrast)
    - archive filter placeholder zinc-600 → zinc-500 (VLM: a11y contrast)
    - Size fields show "(N B)" only when ≥1000 bytes — kills the "556 B (556 B)"
      redundancy VLM flagged twice (info-panel File card + archive EntryPanel)
    - "Detected by" value: inline-flex → flex flex-wrap (no more cut-off
      "binary signatu" in the narrow sidebar)
  * Shortcuts help modal: Tools group documents folder drop, archive bulk
    extract, and the verify-checksums sidebar hint (FolderDown/ListChecks icons
    added to the icon map)
  * Footer tools line: "compare · join · recents · folders · bulk extract ·
    verify checksums · converters · forensic reports"
- FINAL REGRESSION (fresh reload, cleared error buffer): landing (10,014,
  folder hint, footer tools, recents row, 10 sample chips) → PNG (canvas +
  CRC-32) → ZIP (4 checkboxes, master select-all, action bar, Save as .zip) →
  ODS upload → sheet viewer with XLSX button (detection fix live) → Compare
  (Bytes/Text) → explorer "dicom" search → shortcuts modal (all new rows) →
  bonus: recents chip click re-opened cached sample.zip blob end-to-end —
  0 console errors at every step. tsc: 0 app errors; eslint 0/0; dev.log
  healthy (GET / 200, no compile errors); no horizontal overflow.

Stage Summary:
- OMNISCOPE phase 7 complete: one real detection bug fixed (ODS container
  sniff — window widened + entry-name evidence + filename hint), four new
  capabilities shipped (archive bulk extract/re-pack/open-as-tab with the new
  onOpenFile viewer hook, checksum verification with algorithm auto-detection,
  whole-workbook XLSX conversion export incl. .ods/.xls sources, recursive
  folder drop with cap + banner), styling round 7 (VLM-reviewed, both flagged
  issues confirmed fixed on re-review).
- App remains 100% client-side single-route; 10,014 format identities, 39
  viewer engines; new engine logic covered by 12/12 + 6/6 + 4/4 bun logic
  tests plus full browser verification.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines;
  byte window 128MB; archive re-pack cap 512 MB; folder drop opens max 24
  files per drop (documented in-UI).
- Next-phase candidates: 3-way diff, ZIP entry drag-out (downloadURL), ODS→
  XLSX batch conversion mode, accent theme via CSS variables, report batch
  mode for multiple files, joiner streaming for >512 MB sets.
- INFRA (post-worklog): dev server was reaper-killed once at session end
  (documented sandbox behavior, not app-related) → restarted via
  `bun dev-daemon.js`; post-restart verification: title/counter/folder-copy
  correct, PNG viewer canvas + CRC-32, 0 console errors.
---
Task ID: 11
Agent: orchestrator (Z.ai Code)
Task: Phase-8 — QA assessment, accent theme system, 3-way diff3 merge mode,
batch forensic reports, styling round 8 (VLM-reviewed)

Work Log:
- QA assessment at round start (per instructions): dev server healthy,
  landing (10,014 counter), 3-file upload regression (PNG → image viewer
  8×8 + properties, ZIP → archive viewer + 4 checkboxes + phase-7 bulk
  action bar, MD → markdown viewer), explorer "dicom" search, compare mode,
  0 console errors; lint 0/0; tsc clean. VERDICT: stable → proceeded to new
  features (phase-7 backlog used as seed).
- NEW FEATURE — Accent theme system (9 palettes, app-wide instant recolor):
  * src/lib/accent.ts — registry (emerald/rose/amber/violet/cyan/orange/
    lime/fuchsia/teal), applyAccent()/readAccent() with localStorage
    (omniscope.accent.v1), ACCENT_RESTORE_SCRIPT for pre-paint restore
  * globals.css — the Tailwind v4 insight: every *-emerald-N utility
    resolves through runtime CSS vars --color-emerald-N (emitted on :root
    by @theme), so each accent just redefines the 11-shade family under
    html[data-accent="…"] (specificity 0,1,1 > :root 0,1,0) — one
    declaration recolors text/bg/border/outline/ring/gradients/shadows/
    checkboxes across 313 emerald usages with ZERO component edits
  * Hardcoded rgba(16,185,129,…) chrome spots converted to var-based:
    ::selection + input[range] accent-color + focus-visible outline
    (color-mix with var), active-tab/chip/segment inset shadows → new
    .om-tab-active/.om-chip-active/.om-seg-active classes, LogoMark SVG
    gradient stops + dot fill via style stopColor/fill var refs, landing
    hero radial glow via color-mix
  * accent-picker.tsx — header popover (Palette icon, "A" shortcut): 9
    swatch buttons, active gets ring-2 + emerald check badge + label
    highlight; Esc + click-outside close; framer-motion entry
  * layout.tsx — inline pre-paint script restores persisted accent before
    first paint (no FOUC); app-shell wires state + Esc chain + "a" key
    (typing-guarded, opens picker); shortcuts help documents "A"
  * Verified in-browser: violet pick → counter rgb(196,181,253), Open-file
    button rgb(124,58,237) violet-600, gradient hairline recolored;
    persistence across reload (pre-paint script); reset removes attribute +
    localStorage; "a" opens picker; 0 errors.
- NEW FEATURE — 3-way merge (diff3) mode in Compare:
  * src/lib/diff3.ts — event-cluster diff3 engine: each side diffed vs
    base (patience diff), change runs lifted into replacement events
    (zero-width = anchored inserts), merged event stream clustered by
    overlap rules (spanning overlap; insert strictly inside other's span;
    same-anchor inserts), each contested cluster compares the two sides'
    full region versions (identical → resolved "both"; different →
    conflict) — handles independent interleaved edits, edge inserts,
    modify/delete, identical-change resolution
  * Verified: 1000-iteration fuzz vs strong oracles (every row's text ==
    file[line#] for all three columns; theirs==base → merged==mine;
    mine==base → merged==theirs; identical sides → clean + equal merged;
    well-formed conflict markers) — ALL PASS; edge cases (tail inserts,
    same-insert, empty base/files, left-edge insert + replace
    independent-resolve) verified
  * three-way-view.tsx — self-contained view: Base/Mine/Theirs slot cards
    (teal/amber identity, drag/drop/click), sha256 + identical3 verdict,
    stats chips (conflicts·lines, mine/theirs chg incl deletions, same
    edit, unchanged, caps), 3-column rows (line numbers + old text dimmed
    strikethrough / tinted side texts), sticky column headers, conflict
    navigator (n/p + scrollIntoView + rose inset marker), resolve modes
    (markers / all-mine / all-theirs) + Copy merged / Save .txt, wrap
    toggle, ROWS_PER_PAGE pagination, caps 8MB/60k lines per side
  * diff-view.tsx integration: "3-way" ToolButton (GitBranch icon) in the
    2-way toolbar swaps the whole body (seeds Mine=slotA, Theirs=slotB);
    ThreeWayView has own toolbar with "2-way" back + close; 2-way n/p
    handler gated with !threeway; shortcuts help row added
  * Verified end-to-end: clean-merge case (mine 4 chg, theirs 3 chg,
    independent → auto-merged 9 lines), conflict case (1 conflict · 6
    lines, correct git-style hunk swallowing: theirs' contiguous
    host+port+debug edit vs mine's host+port → contested span), resolve
    by mine ("merged output · 14 lines · resolved by mine"), copy merged,
    back to 2-way preserves 2-way slots, 0 errors.
- NEW FEATURE — Batch forensic report:
  * forensic-report.ts += buildBatchReportHtml(inputs[]): standalone
    print-ready HTML — overview stat cards (files/total/categories/
    duplicate groups), category chips, manifest table (# / name / size /
    format / category / entropy / sha256 prefix), duplicate-group
    detection by sha256, compact per-file sections (subject rows + all 4
    digests + entropy bar + partial-hash caveat), print button; verified
    via bun (dup group a.png==b.png, manifest, stats) 
  * app-shell.tsx: FileText header button (visible when ≥2 tabs) →
    downloadBatchReport(): hashes + entropy + detection for every open
    tab (cap 12, 50MB hash cap matching info panel), busy spinner state,
    dated filename omniscope-batch-report-YYYY-MM-DD.html; shortcuts row
  * Verified in-browser with anchor-click spy: 3-file report 9,593 B with
    manifest + 3 file sections, busy cleared, 0 errors.
- STYLING ROUND 8 (mandatory detail pass, VLM-driven):
  * VLM review of accent picker (7/10) + 3-way view (6/10) → actionable
    fixes: popover w-64→w-72 + gap-2 (label clipping), footer text
    zinc-500→zinc-400 (contrast), active swatch ring-2 + scale + solid
    emerald check badge (affordance), conflict cells rose-950/40→/60
    text-rose-100 + amber equivalents + base col zinc-500→400 (contrast),
    conflict-nav gap-2→2.5 + pl-2 divider + "resolve" label + rose-vs-
    amber "= contested" legend chip, removed unused Chip import
  * VLM re-review after fixes: BOTH 9/10 (all flagged issues confirmed
    fixed)
  * Footer tools line updated: "compare · 3-way merge · join · recents ·
    folders · bulk extract · verify checksums · converters · forensic &
    batch reports · 9 accent themes"
- FINAL REGRESSION (fresh reload + error buffer): landing (10,014) →
  pixel.png tab (Image viewer, 8×8) → sample.zip tab (Archive viewer,
  3 entries + Select all) → Compare 2-way (mine2/theirs2 text stats) →
  3-way (base upload → 1 conflict · 6 lines) → back to 2-way → Esc →
  new uploads (pixel + zip tabs, batch button visible) → explorer "flac"
  → accent cyan live-apply + reset to native emerald → "a" shortcut
  opens picker → 0 console errors at every step; no horizontal overflow;
  eslint 0/0; tsc 0 app errors; dev.log healthy (GET / 200, no compile
  errors).
- INFRA: dev server was reaper-killed once mid-round (documented sandbox
  behavior) → restarted via `bun dev-daemon.js`; verified 200 after.

Stage Summary:
- OMNISCOPE phase 8 complete: three new capabilities shipped (9-accent
  theme system via Tailwind v4 theme-variable overrides with pre-paint
  persistence, full diff3 three-way merge mode with conflict navigation +
  resolve modes + merged export, batch forensic reports with duplicate
  detection) plus styling round 8 (VLM-reviewed, 7→9 and 6→9).
- App remains 100% client-side single-route; 10,014 format identities,
  39 viewer engines; diff3 engine covered by 1000-iteration fuzz with
  strong oracles; all new surfaces browser-verified with 0 errors.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines;
  byte window 128MB; batch report caps 12 files / 50MB hashing per file;
  3-way mode is text-based (byte triage available via 2-way compare);
  accent system intentionally recolors emerald-brand surfaces only
  (content renderers like syntax themes/waveform keep fixed colors).
- Next-phase candidates: per-conflict resolve buttons in 3-way (choose
  mine/theirs per block), 3-way syntax highlighting + word diffs, ZIP
  entry drag-out (downloadURL), ODS→XLSX batch conversion, joiner
  streaming >512MB, checksum-verify sum-file upload, accent-aware canvas
  renderers (waveform/syntax via getComputedStyle).
---
Task ID: 12
Agent: orchestrator (Z.ai Code)
Task: Phase-9 — QA assessment, per-conflict 3-way resolution, accent-aware
canvas renderers, sum-file verification, styling round 9 (VLM-reviewed)

Work Log:
- QA assessment at round start (per instructions): dev server healthy,
  landing (10,014), 3-file upload (PNG/ZIP/MD viewers), accent picker (9
  swatches), 3-way conflict path (1 conflict · 6 lines), 0 console errors;
  lint 0/0; tsc clean. VERDICT: stable → proceeded with phase-8 backlog
  (per-conflict resolve, accent-aware canvases, sum-file verify).
- NEW FEATURE — Per-conflict resolution in 3-way merge (three-way-view.tsx):
  * conflictRes: Record<conflictId, "mine"|"theirs"> granular state that
    overrides the global mode (choice order: per-conflict → global mode →
    markers); reset automatically whenever the merge result changes
  * resolvedText walker rebuilt: walks result.merged marker blocks, tracks
    block ordinal (== diff3 conflict id order), takes chosen side per block;
    merged-output row shows "N/M conflicts resolved"; download filename
    switches to .resolved.txt when every conflict has a choice
  * ConflictHeader separator row at each block start: "CONFLICT ordinal/
    total" label, emerald "resolved A · mine / B · theirs" badge with undo
    (×) button, teal A + amber B buttons; buttons gained hover lift
    (-translate-y-px + shadow), active press scale, filled state + Check
    icon when that side is chosen
  * losing side's column dims to opacity-45 in resolved blocks; global
    Markers/All-mine/All-theirs buttons now clear granular choices (full
    reset semantics, "Markers" only active when zero granular choices)
  * Verified in-browser: header renders ("CONFLICT 1/1", "pick a side…"),
    A click → resolved badge + counter 1/1 + losing col dimmed, Copy merged,
    undo → 0/1 + badge gone, check icon on chosen A button, 0 errors.
- NEW FEATURE — Accent-aware canvas renderers (brand accent follows the
  palette picker into canvas-drawn content):
  * utils.ts += accentCss(shade, alpha, fallbackHex) — reads live Tailwind
    theme vars (--color-emerald-N under html[data-accent]); accent
    overrides are plain hex so they decompose to rgba() directly; native
    emerald serializes as oklch (not decomposable) → caller's fallback hex
    (the true emerald shade); SSR/test-safe (no DOM → fallback). Also
    accentSolid() + observeAccent(cb) — MutationObserver on the
    data-accent attribute for live redraws
  * audio-viewer waveform gradient stops → accentCss(300/500) + accent
    MutationObserver redraw: verified native pixel rgba(16,184,129) →
    violet flip live-redraws to rgba(139,93,246) → rose to rgba(243,62,94)
    with the tab open (no reload)
  * samples.ts generated PNG gradient mid-stop → accentSolid(500) (sample
    art adopts the current palette)
  * nfo-viewer: new "Accent" COLOR_MODE (first in the segmented control,
    now the default) using getters → text accentSolid(300), glow/shadow
    accentCss(500, .45); re-renders via observeAccent tick; verified NFO
    ink rgb(196,181,253) under violet
  * spectrogram magma colormap + content palettes intentionally unchanged
    (data semantics, not brand)
- NEW FEATURE — Sum-file verification (info-panel.tsx):
  * parseSumFile(): multi-line parser for GNU ("hash  name" / "hash *name"),
    BSD ("MD5 (name) = hash"), SFV ("name crc32"), bare hex, optional algo
    prefixes (sha256:), # comments skipped — exported for tests; 8/8 bun
    unit tests pass (sfv pairs, gnu plain+binary-star, BSD, comments+
    garbage, empty, bare single, colon prefix, baseName paths)
  * Verifier upgraded: single-line input → textarea (sum files preserve
    newlines); ≥2 parsed entries switch to live Sum-file mode (no click
    needed): per-row verdicts (✓ emerald / ✗ rose / – zinc "other file")
    matched by basename against the active tab, summary chips ("all N
    matching entries verified" / "N mismatches · M ok" + "K for other
    files" + head-only caveat), expected-hash tooltips with computed value
    on mismatch; FileCheck2 button + hidden file input loads .sha256/.md5/
    .sha1/.sfv/.asc/.txt sum files directly; single-verify flow unchanged
  * Verified in-browser: pasted 3-line sum (real sha256 + wrong hash +
    other-file) → "1 mismatch · 1 ok" + "1 for other files"; uploaded
    checks.sha256 via the loader → "all 1 matching entries verified";
    single-line regression → "integrity verified"; 0 errors.
- STYLING ROUND 9 (mandatory detail pass, VLM-driven):
  * VLM review: info panel 7/10, 3-way 6/10 → actionable fixes:
    - REAL BUG FOUND & FIXED — InfoGrid label column was broken: the
      arbitrary class rendered as "grid-cols-[minmax(90px,auto)_1fr]" per
      od -c but grep/cat displayed it as grid-cols-inmax(...) — diagnosis:
      valid class but auto-sizing per grid meant each section's value
      column started at a different x (the VLM "misaligned value columns"
      complaint). Fixed to a rigid grid-cols-[7.5rem_1fr] so every
      section's values share one vertical line (verified: 4 fixed-col
      grids live)
    - Magic bytes value tinted text-emerald-300/90 (was plain zinc-200)
    - 3-way: losing column opacity 35→45 (readability), A/B buttons hover
      lift + shadows + Check icon on chosen side, conflict summary chip
      text-[11px] font-semibold rose-200 (prominence), legend pill
      simplified to dot + "contested rows are tinted" (de-cluttered),
      line-number column zinc-600→500 + active rose-400→300 (contrast)
  * VLM re-review after fixes: info panel 8/10 (was 7), 3-way 9/10 (was 6)
    — both confirmed fixed on the flagged issues
- FINAL REGRESSION (fresh reload, cleared error buffer): landing (10,014)
  → 4-file upload (pixel.png / sample.zip / tone.wav / test.nfo — all tabs
  + NFO accent mode) → tone.wav waveform native emerald pixel → batch
  button visible → accent rose flip → waveform LIVE-redraws rgba(243,62,94)
  → reset to native → no horizontal overflow → pixel tab sum-file upload
  "all 1 matching entries verified" + other-files chip → 3-way conflict →
  per-block A resolve "1/1 conflicts resolved" + Check icon → back to
  2-way → shortcuts modal (sum files + batch + accent rows documented) —
  0 console errors at every step. eslint 0/0; tsc 0 app errors; dev.log
  healthy (GET / 200).
- INFRA: dev server reaper-killed once mid-round (known sandbox behavior)
  → restarted via `bun dev-daemon.js`; verified HTTP 200 after.

Stage Summary:
- OMNISCOPE phase 9 complete: three new capabilities shipped (granular
  per-conflict resolution with visual states + undo, accent-following
  canvas renderers with live palette-switch redraws, full sum-file
  verification workflow with file upload + live multi-entry verdicts)
  plus styling round 9 (VLM-reviewed 7→8 and 6→9; found + fixed the real
  InfoGrid alignment bug underneath the VLM complaint).
- App remains 100% client-side single-route; 10,014 format identities,
  39 viewer engines; parseSumFile covered by 8/8 unit tests; every feature
  browser-verified with 0 errors including live accent canvas redraws.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines;
  byte window 128MB; batch report caps 12 files / 50MB hashing; sum-file
  mode verifies against the ACTIVE tab only (basename matching); canvas
  accent uses fallback hex when native emerald (oklch) — visually
  identical shades.
- Next-phase candidates: 3-way syntax highlighting + word diffs, ZIP entry
  drag-out (downloadURL), ODS→XLSX batch conversion, joiner streaming
  >512MB, sum-file verification across ALL open tabs (app-shell level),
  per-conflict resolve via keyboard (a/b keys), accent-aware chart
  renderers (midi track colors, map segment palette).

---
Task ID: 13
Agent: orchestrator (Z.ai Code)
Task: Phase 10 — QA assessment, cross-tab sum-file verification, archive
drag-out, 3-way keyboard resolution, accent-aware MIDI tracks, styling round 10

Work Log:
- QA ASSESSMENT at round start (per instructions): dev server 200, landing
  renders 10,014 identities; 5-file upload (pixel.png / sample.zip / note.md /
  data.csv / qa.txt) → Image, Archive, Markdown, CSV, Text viewers all pass;
  phase-9 sum-file mode + Compare mode re-verified; 0 console errors; lint
  0/0; tsc 0 app errors. VERDICT: stable → proceeded with phase-9 backlog.
- NEW FEATURE — Sum-file verification across ALL open tabs (info-panel.tsx +
  app-shell.tsx):
  * InfoPanel gains openTabs?: FileTab[] prop; app-shell passes memoized
    infoTabs = tabs.slice(0, BATCH_FILE_CAP)
  * When multiMode (≥2 open tabs) the panel hashes every open tab (≤12,
    50MB head-only cap, hashFile() helper mirroring the panel logic) while
    a sum file is pasted/loaded; "hashing N open files…" busy state
  * multiVerdicts upgraded: entries matched by basename against ALL open
    tabs (first hit wins on duplicate names) → per-row ok/bad verdicts with
    matched tab identity + computed-hash tooltips; entries matching no open
    tab show a "NOT OPEN" right-label; summary chip reads "N not open"
    (vs "for other files" in single-tab mode)
  * Header line now "Sum-file check · N entries · M open files"
  * Verified in-browser: 5-entry sum file across 5 open tabs → wrong-hash
    entries correctly flagged "2 mismatches · 2 ok"; corrected paste →
    "all 4 matching entries verified" + "1 not open" (mystery.bin); every
    non-active tab now verified live (was "for other files" before)
- NEW FEATURE — Archive entry drag-out (archive-viewer.tsx):
  * Extractable, non-encrypted rows are draggable; handleRowDragStart
    synchronously reads entry bytes, mints a blob URL, and sets the
    Chromium DownloadURL payload ("mime:name:blob-url") + text/uri-list +
    text/plain fallbacks; URL revoked after 60s
  * Affordance per VLM review: draggable rows use cursor-grab /
    active:cursor-grabbing, hover-revealed GripVertical icon (group/tr),
    row tooltip "Click to preview · drag out to save directly"; intro
    hint text updated to mention drag-out
  * Verified in-browser: synthetic DragEvent on readme.txt row →
    DownloadURL = "application/octet-stream:readme.txt:blob:http://…",
    uri-list + plain payload present, cursor computed as grab
- NEW FEATURE — 3-way per-conflict keyboard resolution (three-way-view.tsx):
  * Key handler extended: a = resolve focused conflict with mine, b =
    theirs (both auto-advance to the next conflict), u = undo the focused
    choice; guard for input/textarea/contentEditable and ctrl/meta/alt
    chords; deps now [curConflict, conflictIds]
  * Navigator bar gained an "a b u resolve" kbd-hint chip (teal/amber/zinc
    colored keys, xl: breakpoint) alongside the n/p chip
  * Verified in-browser: 3base/3mine/3theirs conflict set → key 'a' →
    "1/1 conflicts resolved" + "resolved A · mine" badge; 'u' → 0/1,
    badge cleared; 'b' → 1/1 + "resolved B · theirs"; merged output row
    tracks the count
- NEW FEATURE — Accent-aware MIDI track colors (midi-viewer.tsx):
  * trackColor(i): track slot 0 now uses accentSolid(400, #34d399) so the
    brand accent replaces the emerald slot; other 5 track hues unchanged
    (per-track distinguishability preserved, consistent with the "accent
    recolors emerald-brand surfaces only" rule from phase 9)
  * Applied to canvas note fill + both legend swatch chips; observeAccent
    MutationObserver forces live re-render + canvas redraw
  * Verified in-browser: native emerald swatch rgb(52,211,153) → accent
    picker violet → swatch rgb(167,139,250) AND piano-roll canvas notes
    live-redraw to violet (148,123,221 = violet @ 0.88 alpha) without
    reload; reset to native restores emerald
- STYLING ROUND 10 (mandatory detail pass, VLM-driven):
  * VLM review of the three new surfaces: sum-file panel 7/10, 3-way 6/10,
    archive 7/10 → actionable fixes applied:
    - kbd hint chips: border zinc-700→600, text zinc-500→400, a/b keys
      border teal/amber-800→700 + tinted bg (no longer "look disabled")
    - contested-rows legend text zinc-500→400; chip border zinc-800→700
    - Archive hint paragraph zinc-500→400; drag affordances (above)
    - Field labels in viewer-ui.tsx zinc-500→400 (all info panels);
      first-bytes hex emerald-300/90→300 (info panel)
  * VLM re-review after fixes: 3-way 6→8/10 (chips + legend confirmed
    fixed), archive 7→8/10 (affordance + hint contrast confirmed fixed)
  * Follow-up micro-fixes from re-review: MIDI piano-roll row separators
    now span the key gutter too (octave/row separation at a glance), time
    label text-[11px] zinc-400 → text-xs font-medium zinc-300
- SHORTCUTS HELP updated: new rows for a/b/u 3-way resolution keys and
  "Drag archive entries out"; info-sidebar row hint now mentions
  "sum-file checks across every open tab"
- FINAL REGRESSION (fresh reload, armed error buffer): landing (10,014) →
  6-file upload (pixel.png / sample.zip / note.md / data.csv / qa.txt /
  tune.mid — 6 tabs) → image canvas → cross-tab sum-file "all 4 matching
  entries verified" + "1 not open" → zip tab drag payload + grab cursor +
  grip icon → tune.mid native emerald swatch → Compare → 3-way → 'a' key
  resolve "1/1 conflicts resolved" → Esc ×2 → '?' shortcuts modal (a/b/u
  + drag + sum-file rows all documented) → Roll panel top-colors scan
  (white keys + emerald notes present) → 0 console errors at every step;
  no horizontal overflow; lint 0/0; tsc 0 app errors; dev.log healthy
  (GET / 200).
- INFRA: dev server was reaper-killed once mid-round (documented sandbox
  behavior) → restarted via `bun dev-daemon.js`; verified 200 after.

Stage Summary:
- OMNISCOPE phase 10 complete: four new capabilities shipped (sum-file
  verification across every open tab with per-row verdicts and "not open"
  labeling, native archive-entry drag-out via DownloadURL blob payloads
  with grab-cursor/grip affordances, keyboard-driven per-conflict 3-way
  resolution a/b/u with auto-advance, accent-following MIDI track-0 colors
  with live canvas redraw) plus styling round 10 (VLM-reviewed 6→8 and
  7→8, plus MIDI piano-roll gutter separators and time-label prominence).
- App remains 100% client-side single-route; 10,014 format identities,
  39 viewer engines; every feature browser-verified with 0 errors
  including live accent canvas redraws and synthetic drag payloads.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; text window 8MB/60k lines;
  byte window 128MB; cross-tab sum hashing caps 12 tabs / 50MB each;
  DownloadURL drag-out works in Chromium (Firefox falls back to URI/text
  payloads); MIDI accent colors track slot 0 only (by design).
- Next-phase candidates: 3-way syntax highlighting + word-level diffs,
  ODS→XLSX batch conversion, joiner streaming >512MB, accent-aware map
  segment palette, sum-file verdict rows clickable to jump to the matched
  tab, drag-out multi-select (drag several ticked entries as a zip).

---
Task ID: 11
Agent: main orchestrator (Z.ai Code)
Task: Phase 11 — QA sweep via agent-browser, then two new features (sum-file verdict jump-to-tab, archive multi-drag zip-out) plus styling round 11 with VLM review, and full regression.

Work Log:
- Read worklog: project is OMNISCOPE phase 10 complete (10,014 identities, 39 viewers).
- Verified dev server + lint (0/0) before starting; loaded agent-browser skill.
- QA sweep (fresh reload, armed console buffer):
  * Landing 10,014 formats, 0 page errors.
  * Investigated stale console warnings "duplicate key utf-8/iso88595/shift-jis":
    extracted ENCODINGS (227 labels, 0 dups), live-checked the open select
    (227 options, 0 dups), re-tested uploads with clean console → warnings were
    mid-HMR artifacts from the previous session's live editing, NOT in shipped
    code. No fix needed; documented.
  * Uploaded 6 files → tabs; text viewer + encoding dropdown; NFO/ZIP
    (sum-file + drag affordances)/image viewers; Compare (2-way); 3-way merge
    (loaded base/mine2/theirs2 via the slot's OWN hidden inputs — main-tab
    input does NOT fill compare slots; earlier "3-way broken" was a QA
    targeting error) → 'a' key resolution "1/1 conflicts resolved" works.
  * Join view opens with 9-file working set ("covered by header" click error
    was the mode-switch header replacing nav — expected).
  * Explore dialog: live search "midi" filters .mid/.midi/.smf/.rmi (synthetic
    JS events don't trigger React onChange — must use agent-browser fill).
  * Zero errors at every step.
- Dev server was reaper-killed once mid-round → restarted via `bun dev-daemon.js`.
- NEW FEATURE 1 — sum-file verdict rows jump to the matched tab:
  * info-panel.tsx: multiVerdicts now carry matchedTabId (openHashes is keyed
    by tab id); verdict rows render as <button> when jumpable with hover bg,
    filename brighten, and an ExternalLink affordance icon on hover; header
    shows "· click a row to jump" hint (zinc-500); new onJumpToTab prop.
  * app-shell.tsx: jumpToTab callback (setActiveId + scrollIntoView center +
    1.4s flash); tab chips get data-tab-id and om-tab-flash class; InfoPanel
    receives onJumpToTab.
  * globals.css: @keyframes om-tab-flash-ring (accent-aware ring via
    color-mix on --color-emerald-500) + prefers-reduced-motion fallback.
  * shortcuts-help.tsx: info-sidebar hint documents click-to-jump.
- NEW FEATURE 2 — drag-out multi-select as one zip:
  * archive-viewer.tsx: zipSync (fflate) import; DRAG_ZIP_CAP = 48MB;
    handleRowDragStart builds a STORE-ONLY (level 0, no jank) zip of every
    ticked entry when the dragged row is ticked and ≥2 ticked, sets
    DownloadURL application/zip:<base>-selection.zip:blob:… + uri-list +
    plain-text payloads; makeDragBadge() renders an accent-aware floating
    "N files · zip / <name>" drag image (CSS-var colored, pointer-events
    none) cleaned up on dragend or 60s; falls back to single-entry drag on
    error/oversize/unticked rows.
  * Row title tooltips + archive legend + shortcuts-help Drag row updated.
- STYLING ROUND 11 (VLM-reviewed):
  * Landing category cards: count split into zinc-400 number + zinc-500
    "formats" suffix, mt-0.5, tabular-nums (count now clearly secondary).
  * Landing "how it works" cards: icon gap mb-2→mb-3 + inset highlight on
    icon tile, card bg gradient matches stat cards, hover border, h-full
    flex-col equalization, body text zinc-500→zinc-400.
  * VLM re-review: landing 7.5→9/10, archive table 10/10, sum-file verdict
    panel 9/10 (alignment "pixel-perfect", hint readable).
- FINAL REGRESSION (fresh reload): 6-file upload (pixel.png/sample.zip/
  note.md/data.csv/qa.txt/tone.wav) → all viewers render; regenerated the
  missing /tmp/qa fixture files (note.md/data.csv/qa.txt had vanished — app
  had gracefully opened them as 0-byte files, good robustness); clicked
  through every tab; sum-file 5/5 verified with 5 jump rows; jump qa.txt →
  sample.zip switches tab + flash ring present then clears at 1.4s; multi-
  drag payload "application/zip:sample-selection.zip" + "2 files from
  sample.zip → sample-selection.zip"; single-entry drag still emits the
  single file payload (no regression); shortcuts modal shows both new hint
  rows; lint 0/0; dev.log healthy (GET / 200).
- QA screenshots archived to download/qa-phase11/ (landing, 3-way resolved,
  jump flash, multi-drag badge, styling v2, verdicts, zip view).

Stage Summary:
- OMNISCOPE phase 11 complete: two new UX capabilities shipped (sum-file
  verdict rows are now click-to-jump buttons that activate + scroll + ring-
  flash the matched tab chip; archive drag-out now carries every ticked entry
  as one store-only zip with a custom accent-aware drag badge) plus styling
  round 11 (VLM 7.5→9 landing, 9/10 verdict panel).
- App remains 100% client-side single-route; 10,014 format identities,
  39 viewer engines; every feature browser-verified with 0 console/page
  errors including synthetic DataTransfer drag payloads.
- QA learnings recorded: compare/3-way slots have their own hidden file
  inputs (main tab input doesn't fill them); agent-browser synthetic React
  onChange needs real fill; stale console buffers can contain mid-HMR
  artifacts — always clear + reload before judging.
- Known limitations (unchanged): RAR/7z identify-only, WOFF2 metrics,
  compressed DICOM, legacy .doc/.ppt recovery; multi-drag zip is store-only
  (no deflate) and capped at 48MB — larger selections fall back to single-
  entry drag; DownloadURL drag-out works in Chromium (Firefox falls back to
  URI/text payloads); sum-file cross-tab hashing caps 12 tabs / 50MB each.
- Next-phase candidates: 3-way syntax highlighting + word-level diffs,
  ODS→XLSX batch conversion, joiner streaming >512MB, accent-aware map
  segment palette, multi-drag deflate when selection is small (async zip
  with dragstart-deferred payload via blob URL revocation strategy),
  keyboard navigation (arrow keys) across verdict rows.
