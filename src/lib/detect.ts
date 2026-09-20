import type { DetectedFormat, FormatRecord } from "@/lib/types";
import { matchSignatures, matchRecordSignature } from "@/lib/formats/signatures";
import { findByExt, findByKey, EXT_MAP } from "@/lib/formats";
import { isLikelyValidUtf8, printabilityRatio, toHex } from "@/lib/utils";
import { findAscii, u32le } from "@/lib/binary";

const UNKNOWN: DetectedFormat = {
  record: null, name: "Unknown / Raw binary", cat: "binary", viewer: "hex",
  mime: "application/octet-stream", method: "unknown",
};

export function getExt(name: string): string | undefined {
  // two-segment compound conventions (tar.gz, env.production, d.ts, min.js …)
  const m = /\.([a-z0-9]+\.[a-z0-9-]+)$/i.exec(name);
  if (m) {
    const compound = m[1].toLowerCase();
    if (EXT_MAP.has(compound)) return compound;
    const tar = /\.(tar)\.([a-z0-9]+)$/i.exec(name);
    if (tar) return `tar.${tar[2].toLowerCase()}`;
    const state = /\.(state)\.([a-z0-9]+)$/i.exec(name);
    if (state) return `state.${state[2].toLowerCase()}`;
  }
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return undefined;
  return name.slice(i + 1).toLowerCase();
}

/* ------------------------- container sniffing ------------------------- */

/** Sniff OOXML / EPUB / ODF / APK / JAR inside a ZIP. */
function sniffZip(head: Uint8Array, name?: string): { key: string; extra?: string } | null {
  /*
   * EPUB & ODF store "mimetype" as first entry (STORED) — appears near offset 30.
   * Some writers (SheetJS ODS) lead with META-INF/manifest.xml and place mimetype
   * later, so search the whole head window for the name→data adjacency pattern.
   */
  const headEnd = Math.min(head.length, 65536);
  if (findAscii(head, "mimetypeapplication/epub+archive", 0, headEnd) >= 0) return { key: "epub" };
  const odf = findAscii(head, "mimetypeapplication/vnd.oasis.opendocument.", 0, headEnd);
  if (odf >= 0) {
    const type = new TextDecoder().decode(head.subarray(odf + 8, Math.min(odf + 70, head.length)));
    if (type.startsWith("application/vnd.oasis.opendocument.spreadsheet")) return { key: "ods" };
    if (type.startsWith("application/vnd.oasis.opendocument.presentation")) return { key: "odp" };
    if (type.startsWith("application/vnd.oasis.opendocument.graphics")) return { key: "odg" };
    return { key: "odt" };
  }
  /*
   * Walk every PK\x03\x04 local file header in the head buffer and collect entry
   * names. Entry names are stored UNCOMPRESSED in local headers even when the
   * file data is deflated, so this identifies OOXML/epub-style zips regardless
   * of where [Content_Types].xml sits (SheetJS and many writers put xl/ entries
   * first — the old 512-byte name search missed those and reported plain ZIP).
   */
  const names: string[] = [];
  const limit = Math.min(head.length, 65536);
  for (let i = 0; i + 30 <= limit; i++) {
    if (head[i] !== 0x50 || head[i + 1] !== 0x4b || head[i + 2] !== 0x03 || head[i + 3] !== 0x04) continue;
    const nameLen = head[i + 26] | (head[i + 27] << 8);
    const extraLen = head[i + 28] | (head[i + 29] << 8);
    if (nameLen > 0 && nameLen <= 256 && extraLen < 1024 && i + 30 + nameLen <= limit) {
      names.push(new TextDecoder("latin1").decode(head.subarray(i + 30, i + 30 + nameLen)));
    }
  }
  const hasPrefix = (p: string) => names.some((n) => n.startsWith(p));
  const hasName = (n: string) => names.includes(n);
  if (hasName("[Content_Types].xml") || hasPrefix("xl/") || hasPrefix("word/") || hasPrefix("ppt/")) {
    if (hasPrefix("xl/")) return { key: "xlsx" };
    if (hasPrefix("word/")) return { key: "docx" };
    if (hasPrefix("ppt/")) return { key: "pptx" };
    return { key: "zip" };
  }
  if (hasName("AndroidManifest.xml")) return { key: "apk" };
  if (hasName("META-INF/MANIFEST.MF")) return { key: "jar" };
  if (hasPrefix("usr/Data")) return { key: "usdz" };
  /*
   * ODF package without a decodable mimetype entry (some writers omit it or store
   * it deflated): the manifest + content.xml pair is conclusive ODF evidence.
   * Resolve the flavor from the extension, defaulting to text.
   */
  if (hasName("META-INF/manifest.xml") && (hasName("content.xml") || hasName("styles.xml"))) {
    const e = name && name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (e === "ods" || e === "ots") return { key: "ods" };
    if (e === "odp" || e === "otp") return { key: "odp" };
    if (e === "odg" || e === "otg") return { key: "odg" };
    return { key: "odt" };
  }
  return { key: "zip" };
}

/** Minimal CFB (Compound File Binary) directory scan for office detection. */
function sniffCfb(head: Uint8Array): { key: string } | null {
  try {
    if (head.length < 0x50) return { key: "doc" };
    const sectorShift = head[0x1e] | (head[0x1f] << 8);
    const sectorSize = 1 << sectorShift;
    const dirStart = u32le(head, 0x30);
    if (sectorSize !== 512 && sectorSize !== 4096) return { key: "doc" };
    const dirOff = sectorSize === 512 ? 512 + dirStart * sectorSize : dirStart * sectorSize;
    if (dirOff + 128 > head.length) return { key: "doc" };
    const names: string[] = [];
    const nEntries = Math.min(16, Math.floor((head.length - dirOff) / 128));
    for (let i = 0; i < nEntries; i++) {
      const e = dirOff + i * 128;
      const nameLen = u32le(head, e + 64);
      if (nameLen < 4 || nameLen > 64) continue;
      let name = "";
      for (let j = 0; j < Math.floor(nameLen / 2) - 1; j++) {
        name += String.fromCharCode(head[e + j * 2] | (head[e + j * 2 + 1] << 8));
      }
      if (name) names.push(name);
    }
    const joined = names.join("|").toLowerCase();
    if (joined.includes("worddocument")) return { key: "doc" };
    if (joined.includes("workbook") || joined.includes("book")) return { key: "xls" };
    if (joined.includes("powerpoint document")) return { key: "ppt" };
    if (joined.includes("visio document")) return { key: "vsd" };
    if (joined.includes("project")) return { key: "mpp" };
    if (joined.includes("accesstableheader") || joined.includes("catalog")) return { key: "mdb" };
    return { key: "doc" };
  } catch {
    return { key: "doc" };
  }
}

/* ------------------------------ main pipeline ---------------------------- */

export function detectFromHead(name: string, head: Uint8Array): DetectedFormat {
  if (!head || head.length === 0) return { ...UNKNOWN, name: "Empty file", viewer: "text", cat: "text" };
  const ext = getExt(name);
  const extRecord = findByExt(ext);
  const conflicts: string[] = [];

  // 1) magic signatures
  const sigMatches = matchSignatures(head);
  let magicRecord: FormatRecord | undefined;
  let magicHex: string | undefined;
  let containerRecord: FormatRecord | undefined;

  for (const m of sigMatches) {
    const hex = m.sig.pattern.replace(/\?\?/g, "·");
    let rec = findByKey(m.sig.key);
    // deeper container sniffing for zip / cfb
    if (m.sig.key === "zip" || (m.sig.key !== "zip" && m.sig.pattern === "50 4B 03 04")) {
      const z = sniffZip(head, name);
      if (z) {
        const zr = findByKey(z.key) ?? findByKey("zip");
        if (zr) { containerRecord = zr; magicHex = hex; break; }
      }
    }
    if (m.sig.key === "cfb") {
      const c = sniffCfb(head);
      if (c) {
        const cr = findByKey(c.key);
        if (cr) { containerRecord = cr; magicHex = hex; break; }
      }
    }
    if (!rec && containerRecord) rec = containerRecord;
    if (rec) {
      magicRecord = rec;
      magicHex = hex;
      break;
    }
  }
  if (sigMatches.length && !magicRecord && !containerRecord) {
    // signature matched but no record routes it — still report the raw name
    const first = sigMatches[0];
    return {
      record: null,
      name: first.sig.name,
      cat: "binary",
      viewer: "hex",
      mime: "application/octet-stream",
      method: "magic",
      magicHex: first.hex.replace(/\?\?/g, "·"),
      ext,
    };
  }

  const chosen = magicRecord ?? containerRecord;
  if (chosen) {
    // The generic XML magic (<?xml) hides many specific XML-based formats (GPX/KML/SVG/TCX…).
    // When the only match is the generic XML container, prefer the extension's record.
    let resolved = chosen;
    const genericXml =
      (chosen.key === "xml" || chosen.viewer === "xml") && sigMatches.every((m) => m.sig.key === "xml");
    if (genericXml && extRecord && extRecord.viewer !== "xml") {
      resolved = extRecord;
    }
    if (extRecord && extRecord.key !== resolved.key) conflicts.push(`${extRecord.name} (from extension .${ext})`);
    return {
      record: resolved,
      name: resolved.name,
      cat: resolved.cat,
      viewer: resolved.viewer,
      mime: resolved.mime ?? "application/octet-stream",
      desc: resolved.desc,
      method: containerRecord ? "container" : "magic",
      magicHex,
      ext,
      conflicts: conflicts.length ? conflicts : undefined,
    };
  }

  // 2) record signatures not in curated list (from db)
  if (extRecord?.sig && matchRecordSignature(head, extRecord.sig, extRecord.sigOffset ?? 0)) {
    return {
      record: extRecord, name: extRecord.name, cat: extRecord.cat, viewer: extRecord.viewer,
      mime: extRecord.mime ?? "application/octet-stream", desc: extRecord.desc,
      method: "magic", magicHex: extRecord.sig.replace(/\?\?/g, "·"), ext,
    };
  }

  // 3) extension
  if (extRecord) {
    return {
      record: extRecord, name: extRecord.name, cat: extRecord.cat, viewer: extRecord.viewer,
      mime: extRecord.mime ?? "application/octet-stream", desc: extRecord.desc,
      method: "extension", ext,
    };
  }

  // 4) content sniffing for text-like data
  const printable = printabilityRatio(head);
  const validUtf8 = isLikelyValidUtf8(head);
  if (printable > 0.85 && validUtf8) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, Math.min(head.length, 2048)));
    const t = text.trimStart();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        JSON.parse(t.length > 100 ? t.slice(0, 100) + (t.endsWith("}") ? "" : "") : t);
        return { record: null, name: "JSON data (detected)", cat: "data", viewer: "json", mime: "application/json", method: "content", ext };
      } catch { /* not json */ }
      if (/^\s*[\{\[]/.test(t) && (t.includes(":") || t.includes(","))) {
        return { record: null, name: "JSON-like data", cat: "data", viewer: "json", mime: "text/plain", method: "content", ext };
      }
    }
    if (t.startsWith("<")) {
      if (/^<svg/i.test(t)) return { record: null, name: "SVG image (detected)", cat: "image", viewer: "svg", mime: "image/svg+xml", method: "content", ext };
      if (/^<(\?xml|rss|feed|kml|gpx|xhtml|html|!doctype html)/i.test(t)) {
        const isHtml = /^<(!doctype|html)/i.test(t.replace(/\s+/g, " "));
        return {
          record: null, name: isHtml ? "HTML document (detected)" : "XML document (detected)",
          cat: isHtml ? "document" : "data", viewer: isHtml ? "code" : "xml",
          mime: isHtml ? "text/html" : "application/xml", method: "content", ext,
        };
      }
    }
    if (t.startsWith("#!")) {
      const line1 = t.split("\n")[0];
      const interp = line1.replace("#!", "").trim();
      return { record: null, name: `Script (${interp || "shebang"})`, cat: "code", viewer: "code", mime: "text/x-shellscript", method: "content", ext };
    }
    if (t.startsWith(";;") || t.startsWith(";")) {
      return { record: null, name: "INI-like configuration", cat: "config", viewer: "code", mime: "text/plain", method: "content", ext };
    }
    // CSV sniff: consistent delimiter counts across first lines
    const lines = t.split(/\r?\n/).filter(Boolean).slice(0, 5);
    if (lines.length >= 2) {
      for (const d of [",", "\t", ";", "|"]) {
        const counts = lines.map((l) => l.split(d).length - 1);
        if (counts[0] > 0 && counts.every((c) => c === counts[0])) {
          return { record: null, name: `Delimited text (${d === "\t" ? "TSV" : d === "," ? "CSV" : d === ";" ? "semicolon" : "pipe"})`, cat: "data", viewer: "csv", mime: "text/csv", method: "content", ext };
        }
      }
    }
    return { record: null, name: "Plain text (detected)", cat: "text", viewer: "text", mime: "text/plain", method: "content", ext };
  }

  // 5) unknown binary
  const headHex = toHex(head.subarray(0, Math.min(8, head.length)));
  return { ...UNKNOWN, magicHex: headHex, ext };
}
