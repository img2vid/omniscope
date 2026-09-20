/* ============================ forensic report ============================= */

/**
 * Builds a standalone, print-ready HTML forensic report for a single file.
 * Pure string builder — no DOM, so it is unit-testable in bun and SSR-safe.
 * The output embeds all CSS (paper-light print styles + on-screen dark chrome)
 * and a Print button; no external resources are referenced.
 */

import { formatBytes, formatNum, humanBitsPerByte } from "./utils";

export interface ForensicHashes {
  crc32: string;
  md5: string;
  sha1: string;
  sha256: string;
}

export interface ForensicInput {
  fileName: string;
  size: number;
  lastModified: number;
  mime: string;
  formatName?: string;
  category?: string;
  method?: string;
  ext?: string;
  magicHex?: string;
  conflicts?: string[];
  viewerLabel?: string;
  entropy: number | null;
  headHex?: string;
  hashes?: ForensicHashes;
  /** true when the file exceeded the hashing cap → hashes cover the head only */
  hashPartial?: boolean;
  hashLimitBytes?: number;
  tool: string;
  identities: number;
  generatedAt?: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return (
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
  );
}

function entropyClass(h: number): string {
  if (h >= 7.2) return "high — likely compressed or encrypted";
  if (h >= 6) return "elevated — mixed binary or packed data";
  if (h >= 4) return "medium — structured data";
  return "low — mostly uniform / text-like";
}

const METHOD_LABELS: Record<string, string> = {
  magic: "binary signature (magic bytes)",
  container: "container sniff (CFB / OOXML zip)",
  extension: "file extension",
  content: "content sniff",
  unknown: "unidentified",
};

function methodLabel(method: string | undefined): string {
  if (!method) return "—";
  return METHOD_LABELS[method] ?? method;
}

function row(label: string, value: string, mono = false): string {
  const v = value === "" || value === undefined ? "—" : value;
  return `<tr><th>${esc(label)}</th><td${mono ? ' class="mono"' : ""}>${esc(v)}</td></tr>`;
}

export function buildForensicReportHtml(input: ForensicInput): string {
  const gen = input.generatedAt ?? Date.now();
  const headHex = input.headHex ?? "";
  const entropy = input.entropy;
  const hashes = input.hashes;

  const checksumRows = hashes
    ? `<table class="kv">
        ${row("CRC-32", hashes.crc32, true)}
        ${row("MD5", hashes.md5, true)}
        ${row("SHA-1", hashes.sha1, true)}
        ${row("SHA-256", hashes.sha256, true)}
      </table>
      ${
        input.hashPartial
          ? `<p class="note warn">File exceeds ${formatBytes(input.hashLimitBytes ?? 0)} — digest values cover the first ${formatBytes(input.hashLimitBytes ?? 0)} only.</p>`
          : ""
      }`
    : `<p class="note">Checksums were not computed at report time.</p>`;

  const entropyBlock =
    entropy !== null && Number.isFinite(entropy)
      ? `<div class="entropy">
          <div class="bar"><span style="width:${Math.min(100, (entropy / 8) * 100).toFixed(1)}%"></span></div>
          <div class="ent-nums"><span>${entropy.toFixed(3)}</span><span>/ 8.000 bits per byte</span></div>
          <p class="note">${esc(entropyClass(entropy))} — ${esc(humanBitsPerByte(entropy))}.</p>
        </div>`
      : `<p class="note">Entropy was not computed at report time.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="${esc(input.tool)} — client-side forensic report">
<title>Forensic report — ${esc(input.fileName)}</title>
<style>
  :root { --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --accent:#047857; --accent-soft:#ecfdf5; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:#fafaf9; }
  .page { max-width:820px; margin:0 auto; padding:48px 40px 64px; }
  header.rpt { border-bottom:3px solid var(--accent); padding-bottom:18px; margin-bottom:26px; }
  .brand { display:flex; align-items:baseline; gap:10px; }
  .brand .t { font-size:20px; font-weight:800; letter-spacing:.14em; color:var(--accent); }
  .brand .sub { font-size:11px; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; }
  h1 { font-size:22px; margin:10px 0 4px; word-break:break-all; }
  .gen { font-size:12px; color:var(--muted); }
  section { margin:22px 0; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--accent); border-bottom:1px solid var(--line); padding-bottom:6px; margin:0 0 10px; }
  table.kv { width:100%; border-collapse:collapse; }
  table.kv th { text-align:left; font-weight:500; color:var(--muted); width:34%; padding:5px 10px 5px 0; vertical-align:top; white-space:nowrap; }
  table.kv td { padding:5px 0; word-break:break-all; }
  table.kv tr { border-bottom:1px solid #f0efee; }
  td.mono, .mono { font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace; font-size:12.5px; }
  .hash { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; word-break:break-all; background:var(--accent-soft); border:1px solid #d1fae5; border-radius:4px; padding:6px 8px; color:#064e3b; display:block; margin:2px 0; }
  .note { font-size:12px; color:var(--muted); margin:8px 0 0; }
  .note.warn { color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:4px; padding:6px 8px; }
  .entropy .bar { height:10px; border-radius:6px; background:#e7e5e4; overflow:hidden; border:1px solid var(--line); }
  .entropy .bar span { display:block; height:100%; background:linear-gradient(90deg,#059669,#d97706); }
  .ent-nums { display:flex; justify-content:space-between; font-family:ui-monospace,monospace; font-size:12px; color:var(--muted); margin-top:4px; }
  .hex { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; background:#0c0a09; color:#6ee7b7; border-radius:6px; padding:10px 12px; word-break:break-all; line-height:1.7; }
  .badge { display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; border:1px solid var(--accent); color:var(--accent); border-radius:3px; padding:1px 7px; margin-left:8px; vertical-align:2px; }
  footer { border-top:1px solid var(--line); margin-top:30px; padding-top:14px; font-size:11px; color:var(--muted); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .printbar { position:fixed; right:18px; bottom:18px; }
  .printbar button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:9px 16px; font:600 13px/1 ui-sans-serif,system-ui,sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(4,120,87,.35); }
  .printbar button:hover { background:#065f46; }
  @media print {
    body { background:#fff; }
    .page { padding:0; max-width:none; }
    .printbar { display:none; }
    section { break-inside:avoid; }
    h1 { font-size:18px; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="rpt">
    <div class="brand"><span class="t">${esc(input.tool)}</span><span class="sub">file forensics report</span></div>
    <h1>${esc(input.fileName)}</h1>
    <div class="gen">Generated ${esc(fmtDate(gen))} · entirely client-side · nothing was uploaded</div>
  </header>

  <section>
    <h2>Subject</h2>
    <table class="kv">
      ${row("File name", input.fileName, true)}
      ${row("Size", `${formatBytes(input.size)} (${formatNum(input.size)} bytes)`)}
      ${row("Last modified", input.lastModified ? fmtDate(input.lastModified) : "—")}
      ${row("Declared MIME", input.mime)}
      ${row("Viewer", input.viewerLabel ?? "—")}
    </table>
  </section>

  <section>
    <h2>Identification</h2>
    <table class="kv">
      ${row("Identified format", (input.formatName ?? "Unidentified") + (input.ext ? ` (.${input.ext})` : ""))}
      ${row("Category", input.category ?? "—")}
      ${row("Detection method", methodLabel(input.method))}
      ${row("Magic bytes", input.magicHex ?? "—", true)}
    </table>
    ${
      input.conflicts?.length
        ? `<p class="note warn">Extension claimed ${esc(input.conflicts.join("; "))} — the binary signature took priority.</p>`
        : ""
    }
  </section>

  <section>
    <h2>Entropy profile${entropy !== null && Number.isFinite(entropy) ? ` — ${entropy.toFixed(3)} / 8` : ""}</h2>
    ${entropyBlock}
  </section>

  <section>
    <h2>First bytes</h2>
    ${headHex ? `<div class="hex">${esc(headHex)}</div><p class="note">Hexadecimal dump of the first 32 bytes.</p>` : `<p class="note">Head bytes were not captured at report time.</p>`}
  </section>

  <section>
    <h2>Checksums</h2>
    ${checksumRows}
    ${
      hashes
        ? `<span class="hash">sha256 ${esc(hashes.sha256)}</span>
           <p class="note">The SHA-256 above is the verification digest for this exact file. CRC-32 is a quick integrity check, not a security hash.</p>`
        : ""
    }
  </section>

  <footer>
    <span>${esc(input.tool)} · ${esc(formatNum(input.identities))} recognized format identities · computed locally in the browser</span>
    <span>Report generated ${esc(fmtDate(gen))}</span>
  </footer>
</div>
<div class="printbar"><button type="button" onclick="window.print()">Print report</button></div>
</body>
</html>`;
}

/* ============================ batch forensic report ============================ */

/**
 * Builds a standalone, print-ready HTML report covering MANY files at once:
 * an overview (counts, totals, category mix, duplicate detection), a manifest
 * table, and a compact per-file section for each subject. Pure string builder
 * (no DOM) — unit-testable in bun and SSR-safe, same as the single-file report.
 */
export function buildBatchReportHtml(inputs: ForensicInput[]): string {
  const gen = Date.now();
  const tool = inputs[0]?.tool ?? "OMNISCOPE";
  const identities = inputs[0]?.identities ?? 0;
  const totalBytes = inputs.reduce((n, i) => n + i.size, 0);

  /* category mix */
  const cats = new Map<string, number>();
  for (const i of inputs) {
    const c = i.category ?? "unidentified";
    cats.set(c, (cats.get(c) ?? 0) + 1);
  }
  const catChips = [...cats.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([c, n]) => `<span class="chip">${esc(c)} · ${n}</span>`)
    .join(" ");

  /* duplicate detection by sha256 */
  const byHash = new Map<string, number[]>();
  inputs.forEach((i, idx) => {
    const h = i.hashes?.sha256;
    if (!h) return;
    const list = byHash.get(h) ?? [];
    list.push(idx);
    byHash.set(h, list);
  });
  const dupGroups = [...byHash.values()].filter((l) => l.length > 1);
  const dupBlock = dupGroups.length
    ? `<section>
        <h2>Duplicate groups</h2>
        <table class="kv">
          ${dupGroups
            .map(
              (g, n) =>
                `<tr><th>Group ${n + 1}</th><td>${g
                  .map((idx) => esc(inputs[idx].fileName))
                  .join("<br>")}</td></tr>`,
            )
            .join("\n          ")}
        </table>
        <p class="note">${dupGroups.length} group${dupGroups.length === 1 ? "" : "s"} of byte-identical files (matching SHA-256).</p>
      </section>`
    : "";

  /* manifest table */
  const manifestRows = inputs
    .map((i, idx) => {
      const e = i.entropy;
      return `<tr>
        <td class="mono">${idx + 1}</td>
        <td class="mono fname">${esc(i.fileName)}</td>
        <td class="mono">${formatBytes(i.size)}</td>
        <td>${esc(i.formatName ?? "Unidentified")}</td>
        <td>${esc(i.category ?? "—")}</td>
        <td class="mono">${e != null && Number.isFinite(e) ? e.toFixed(2) : "—"}</td>
        <td class="mono sha">${i.hashes ? esc(i.hashes.sha256.slice(0, 16)) + "…" : "—"}</td>
      </tr>`;
    })
    .join("\n      ");

  /* per-file compact sections */
  const fileSections = inputs
    .map((i, idx) => {
      const e = i.entropy;
      const entropyBar =
        e != null && Number.isFinite(e)
          ? `<div class="bar"><span style="width:${Math.min(100, (e / 8) * 100).toFixed(1)}%"></span></div>`
          : "";
      return `<section class="file">
      <h2 class="fn"><span class="idx mono">${idx + 1}</span> ${esc(i.fileName)}</h2>
      <table class="kv">
        ${row("Size", `${formatBytes(i.size)} (${formatNum(i.size)} bytes)`)}
        ${row("Last modified", i.lastModified ? fmtDate(i.lastModified) : "—")}
        ${row("Declared MIME", i.mime)}
        ${row("Format", (i.formatName ?? "Unidentified") + (i.ext ? ` (.${i.ext})` : ""), true)}
        ${row("Identified by", methodLabel(i.method))}
        ${i.magicHex ? row("Magic bytes", i.magicHex, true) : ""}
        ${row("Entropy", e != null && Number.isFinite(e) ? `${e.toFixed(3)} / 8 — ${entropyClass(e)}` : "—")}
        ${row("SHA-256", i.hashes ? i.hashes.sha256 : "—", true)}
        ${row("SHA-1", i.hashes ? i.hashes.sha1 : "—", true)}
        ${row("MD5", i.hashes ? i.hashes.md5 : "—", true)}
        ${row("CRC-32", i.hashes ? i.hashes.crc32 : "—", true)}
      </table>
      ${entropyBar}
      ${
        i.hashPartial
          ? `<p class="note warn">File exceeds ${formatBytes(i.hashLimitBytes ?? 0)} — digest values cover the first ${formatBytes(i.hashLimitBytes ?? 0)} only.</p>`
          : ""
      }
    </section>`;
    })
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="generator" content="${esc(tool)} — client-side batch forensic report">
<title>Batch forensic report — ${inputs.length} files</title>
<style>
  :root { --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --accent:#047857; --accent-soft:#ecfdf5; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:#fafaf9; }
  .page { max-width:920px; margin:0 auto; padding:48px 40px 64px; }
  header.rpt { border-bottom:3px solid var(--accent); padding-bottom:18px; margin-bottom:26px; }
  .brand { display:flex; align-items:baseline; gap:10px; }
  .brand .t { font-size:20px; font-weight:800; letter-spacing:.14em; color:var(--accent); }
  .brand .sub { font-size:11px; color:var(--muted); letter-spacing:.08em; text-transform:uppercase; }
  h1 { font-size:22px; margin:10px 0 4px; }
  .gen { font-size:12px; color:var(--muted); }
  section { margin:22px 0; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.12em; color:var(--accent); border-bottom:1px solid var(--line); padding-bottom:6px; margin:0 0 10px; }
  h2.fn { text-transform:none; letter-spacing:0; font-size:15px; word-break:break-all; color:var(--ink); border-bottom:1px solid var(--line); }
  h2.fn .idx { color:var(--accent); font-weight:700; margin-right:2px; }
  table.kv { width:100%; border-collapse:collapse; }
  table.kv th { text-align:left; font-weight:500; color:var(--muted); width:22%; padding:5px 10px 5px 0; vertical-align:top; white-space:nowrap; }
  table.kv td { padding:5px 0; word-break:break-all; }
  table.kv tr { border-bottom:1px solid #f0efee; }
  td.mono, .mono { font-family:ui-monospace,Menlo,Consolas,"Courier New",monospace; font-size:12.5px; }
  table.manifest { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.manifest th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); border-bottom:2px solid var(--accent); padding:6px 8px; white-space:nowrap; }
  table.manifest td { border-bottom:1px solid #eee; padding:6px 8px; vertical-align:top; }
  table.manifest td.fname { word-break:break-all; }
  table.manifest td.sha { color:var(--muted); }
  .chip { display:inline-block; border:1px solid #a7f3d0; background:var(--accent-soft); color:#065f46; border-radius:99px; padding:2px 10px; font-size:11px; font-weight:600; margin:0 6px 6px 0; }
  .statgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px; }
  .stat { border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:#fff; }
  .stat .n { font-size:20px; font-weight:800; color:var(--accent); font-variant-numeric:tabular-nums; }
  .stat .l { font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-top:2px; }
  .bar { height:8px; border-radius:6px; background:#e7e5e4; overflow:hidden; border:1px solid var(--line); margin:8px 0 0; max-width:420px; }
  .bar span { display:block; height:100%; background:linear-gradient(90deg,#059669,#d97706); }
  .note { font-size:12px; color:var(--muted); margin:8px 0 0; }
  .note.warn { color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:4px; padding:6px 8px; }
  footer { border-top:1px solid var(--line); margin-top:30px; padding-top:14px; font-size:11px; color:var(--muted); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .printbar { position:fixed; right:18px; bottom:18px; }
  .printbar button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:9px 16px; font:600 13px/1 ui-sans-serif,system-ui,sans-serif; cursor:pointer; box-shadow:0 4px 14px rgba(4,120,87,.35); }
  .printbar button:hover { background:#065f46; }
  @media print {
    body { background:#fff; }
    .page { padding:0; max-width:none; }
    .printbar { display:none; }
    section { break-inside:avoid; }
    h1 { font-size:18px; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="rpt">
    <div class="brand"><span class="t">${esc(tool)}</span><span class="sub">batch forensic report · ${formatNum(identities)} format identities</span></div>
    <h1>${inputs.length} files · ${formatBytes(totalBytes)}</h1>
    <div class="gen">Generated ${esc(fmtDate(gen))} · entirely client-side · nothing was uploaded</div>
  </header>

  <section>
    <h2>Overview</h2>
    <div class="statgrid">
      <div class="stat"><div class="n">${inputs.length}</div><div class="l">files</div></div>
      <div class="stat"><div class="n">${formatBytes(totalBytes)}</div><div class="l">total size</div></div>
      <div class="stat"><div class="n">${cats.size}</div><div class="l">categories</div></div>
      <div class="stat"><div class="n">${dupGroups.length}</div><div class="l">duplicate groups</div></div>
    </div>
    <div>${catChips}</div>
  </section>

  <section>
    <h2>Manifest</h2>
    <table class="manifest">
      <thead><tr><th>#</th><th>File</th><th>Size</th><th>Format</th><th>Category</th><th>Entropy</th><th>SHA-256</th></tr></thead>
      <tbody>
      ${manifestRows}
      </tbody>
    </table>
  </section>

  ${dupBlock}

  <section>
    <h2>File details</h2>
    <p class="note">Compact per-file record — full 32-byte digests above.</p>
  </section>
    ${fileSections}

  <footer>
    <span>${esc(tool)} — universal file lab · batch report of ${inputs.length} files</span>
    <span>All analysis performed in-browser; no data left this machine.</span>
  </footer>
</div>
<div class="printbar"><button onclick="print()">Print report</button></div>
</body>
</html>`;
}
