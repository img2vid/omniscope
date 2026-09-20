import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------------------------------- sizes --------------------------------- */

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(digits)} ${units[i]}`;
}

export function formatNum(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/* ----------------------------------- hex ----------------------------------- */

export function toHexByte(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, "0");
}

/* ------------------------------ live accent color ------------------------------ */

/**
 * Read a live accent shade from the Tailwind theme CSS variables
 * (`--color-emerald-N`, redefined per accent under html[data-accent]) and
 * return it as an `rgba()` string with the given alpha.
 *
 * Accent overrides are plain hex, so they decompose directly; the native
 * emerald palette serializes as oklch(), which cannot be decomposed by hand —
 * in that case the caller's fallback hex (the true emerald shade) is used.
 * Safe in SSR / test contexts (falls back without touching the DOM).
 */
export function accentCss(shade: 300 | 400 | 500 | 600, alpha = 1, fallbackHex = "#10b981"): string {
  let v = "";
  try {
    v = getComputedStyle(document.documentElement).getPropertyValue(`--color-emerald-${shade}`).trim();
  } catch {
    return fallbackHex; // no DOM (SSR / bun tests)
  }
  const hex = v.startsWith("#") ? v.slice(1) : fallbackHex.slice(1);
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return fallbackHex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Solid (opaque) accent shade for canvas fill/stroke styles. */
export function accentSolid(shade: 300 | 400 | 500 | 600, fallbackHex: string): string {
  return accentCss(shade, 1, fallbackHex);
}

/**
 * Re-run a callback whenever the accent theme flips (html[data-accent] mutates).
 * Returns a disconnect function. Canvas renderers use this to stay in sync
 * with the palette picker without re-mounting.
 */
export function observeAccent(callback: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => {};
  const mo = new MutationObserver(callback);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent"] });
  return () => mo.disconnect();
}

export function toHex(bytes: Uint8Array, sep = " "): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(toHexByte(bytes[i]));
  return out.join(sep);
}

export function hexDumpLine(bytes: Uint8Array, offset: number): string {
  let hex = "";
  let ascii = "";
  for (let i = 0; i < 16; i++) {
    if (i < bytes.length) {
      const b = bytes[i];
      hex += toHexByte(b) + " ";
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    } else {
      hex += "   ";
      ascii += " ";
    }
    if (i === 7) hex += " ";
  }
  return `${offset.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`;
}

export function parseHexPattern(pattern: string): (number | null)[] | null {
  const parts = pattern.trim().split(/\s+/);
  const out: (number | null)[] = [];
  for (const p of parts) {
    if (p === "??" || p === "**") { out.push(null); continue; }
    if (!/^[0-9a-fA-F]{2}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out.length ? out : null;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* --------------------------------- entropy --------------------------------- */

/** Shannon entropy over the first n bytes (0..8 bits/byte). */
export function shannonEntropy(bytes: Uint8Array, n = Math.min(bytes.length, 65536)): number {
  if (!n) return 0;
  const freq = new Uint32Array(256);
  const limit = Math.min(n, bytes.length);
  for (let i = 0; i < limit; i++) freq[bytes[i]]++;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;
    const p = freq[i] / limit;
    h -= p * Math.log2(p);
  }
  return h;
}

export function byteHistogram(bytes: Uint8Array, n = Math.min(bytes.length, 262144)): Uint32Array {
  const freq = new Uint32Array(256);
  const limit = Math.min(n, bytes.length);
  for (let i = 0; i < limit; i++) freq[bytes[i]]++;
  return freq;
}

export function printabilityRatio(bytes: Uint8Array, n = 4096): number {
  const limit = Math.min(n, bytes.length);
  if (!limit) return 0;
  let printable = 0;
  for (let i = 0; i < limit; i++) {
    const b = bytes[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a || b === 0x0d) printable++;
  }
  return printable / limit;
}

/** byte-map preview: average brightness per cell for a grid of rows×cols */
export function byteMap(bytes: Uint8Array, rows: number, cols: number): Float32Array {
  const cells = new Float32Array(rows * cols);
  const total = rows * cols;
  const n = bytes.length;
  if (!n) return cells;
  const per = Math.max(1, Math.floor(n / total));
  for (let c = 0; c < total; c++) {
    let sum = 0;
    const start = c * per;
    const end = Math.min(start + per, n);
    for (let i = start; i < end; i++) sum += bytes[i];
    cells[c] = end > start ? sum / (end - start) / 255 : 0;
  }
  return cells;
}

/* ---------------------------------- hashes --------------------------------- */

export function crc32(bytes: Uint8Array): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0 ^ -1;
  const limit = Math.min(bytes.length, 50 * 1024 * 1024);
  for (let i = 0; i < limit; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  return digestBuffer("SHA-256", bytes);
}
export async function sha1(bytes: Uint8Array): Promise<string> {
  return digestBuffer("SHA-1", bytes);
}
export async function sha512(bytes: Uint8Array): Promise<string> {
  return digestBuffer("SHA-512", bytes);
}

async function digestBuffer(algo: string, bytes: Uint8Array): Promise<string> {
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
    const digest = await crypto.subtle.digest(algo, buf as ArrayBuffer);
    return Array.from(new Uint8Array(digest)).map(toHexByte).join("").toLowerCase();
  } catch {
    return "—";
  }
}

/** Tiny MD5 implementation (WebCrypto has no MD5). Processes up to 50MB. */
export function md5(bytes: Uint8Array): string {
  const limit = Math.min(bytes.length, 50 * 1024 * 1024);
  const msg = bytes.subarray(0, limit);
  function rl(n: number, c: number) { return (n << c) | (n >>> (32 - c)); }
  function au(x: number, y: number) {
    const l = (x & 0xffff) + (y & 0xffff);
    return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff);
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    return au(rl(au(au(a, q), au(x, t)), s), b);
  }
  const fF = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const fG = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const fH = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(b ^ c ^ d, a, b, x, s, t);
  const fI = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(c ^ (b | ~d), a, b, x, s, t);
  function core(x: number[], k: number[]) {
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    const ff = [fF, fG, fH, fI];
    for (let i = 0; i < 64; i++) {
      const g = i >> 4;
      const r = [b, c, d, a][i % 4];
      const res = ff[g](a, b, c, d, x[i & 15], [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][(g << 2) + (i % 4)], k[i]);
      a = d; d = c; c = b; b = au(b, res);
    }
    return [au(a, 1732584193), au(b, -271733879), au(c, -1732584194), au(d, 271733878)];
  }
  const n = msg.length;
  const withPad = new Uint8Array((((n + 8) >> 6) + 1) << 6);
  withPad.set(msg);
  withPad[n] = 0x80;
  const bitLen = n * 8;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bitLen / 0x100000000), true);
  let h0 = 1732584193, h1 = -271733879, h2 = -1732584194, h3 = 271733878;
  const K: number[] = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const X = new Array(16);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let j = 0; j < 16; j++) X[j] = dv.getUint32(off + j * 4, true);
    const [a, b, c, d] = core(X, K);
    h0 = au(h0, a); h1 = au(h1, b); h2 = au(h2, c); h3 = au(h3, d);
  }
  const out = [h0, h1, h2, h3].map((v) => {
    const u = v >>> 0;
    return [0, 8, 16, 24].map((s) => toHexByte((u >>> s) & 0xff)).join("");
  }).join("");
  return out.toLowerCase();
}

/* --------------------------------- strings --------------------------------- */

export interface FoundString { offset: number; text: string; }

/** Extract ASCII strings of at least minLen. Scans up to `limit` bytes. */
export function extractStrings(
  bytes: Uint8Array,
  minLen = 5,
  limit = 2 * 1024 * 1024,
  maxStrings = 800,
): FoundString[] {
  const out: FoundString[] = [];
  const n = Math.min(bytes.length, limit);
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const b = i < n ? bytes[i] : 0;
    const ok = b >= 0x20 && b < 0x7f;
    if (ok) { if (start < 0) start = i; }
    else {
      if (start >= 0 && i - start >= minLen) {
        out.push({ offset: start, text: latin1(bytes.subarray(start, i)) });
        if (out.length >= maxStrings) return out;
      }
      start = -1;
    }
  }
  return out;
}

/* -------------------------------- encodings -------------------------------- */

export function latin1(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
}

export function utf16LE(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return s;
}

export function utf16BE(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  }
  return s;
}

export function decodeWith(bytes: Uint8Array, label: string): string {
  try {
    // strip BOM
    let b = bytes;
    if (b.length >= 2) {
      if (b[0] === 0xfe && b[1] === 0xff) b = b.subarray(2);
      else if (b[0] === 0xff && b[1] === 0xfe) b = b.subarray(2);
      else if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
    }
    return new TextDecoder(label, { fatal: false }).decode(b);
  } catch {
    return latin1(bytes);
  }
}

export function isLikelyValidUtf8(bytes: Uint8Array, n = 8192): boolean {
  const limit = Math.min(bytes.length, n);
  let i = 0;
  if (limit >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  let cont = 0;
  for (; i < limit; i++) {
    const b = bytes[i];
    if (cont > 0) {
      if ((b & 0xc0) !== 0x80) return false;
      cont--;
    } else if (b < 0x80) {
      // fine
    } else if (b >= 0xc2 && b <= 0xdf) cont = 1;
    else if (b >= 0xe0 && b <= 0xef) cont = 2;
    else if (b >= 0xf0 && b <= 0xf4) cont = 3;
    else return false;
  }
  return true;
}

export interface EncodingGuess { label: string; confidence: number; }

export function guessTextEncoding(head: Uint8Array): EncodingGuess {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return { label: "utf-16le", confidence: 1 };
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return { label: "utf-16be", confidence: 1 };
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { label: "utf-8", confidence: 1 };
  // null-alternation heuristic for UTF-16 without BOM
  if (head.length > 40) {
    let even = 0, odd = 0;
    for (let i = 0; i + 1 < 40; i += 2) {
      if (head[i] === 0 && head[i + 1] !== 0) odd++;
      if (head[i + 1] === 0 && head[i] !== 0) even++;
    }
    if (odd >= 12 && even === 0) return { label: "utf-16be", confidence: 0.8 };
    if (even >= 12 && odd === 0) return { label: "utf-16le", confidence: 0.8 };
  }
  if (isLikelyValidUtf8(head)) return { label: "utf-8", confidence: 0.9 };
  return { label: "windows-1252", confidence: 0.5 };
}

/** Complete WHATWG Encoding Standard label list (all real TextDecoder labels). */
export const ENCODINGS: { group: string; labels: string[] }[] = [
  { group: "Unicode", labels: ["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8"] },
  { group: "UTF-16 / UTF-32", labels: ["utf-16", "utf-16le", "unicodefeff", "utf-16be", "unicodefffe", "utf-32", "utf-32le", "utf-32be"] },
  { group: "Western European", labels: ["ansi_x3.4-1968", "ascii", "cp1252", "cp819", "csisolatin1", "ibm819", "iso-8859-1", "iso-ir-100", "iso8859-1", "iso88591", "iso_8859-1", "iso_8859-1:1987", "l1", "latin1", "us-ascii", "x-cp1252"] },
  { group: "More Latin", labels: ["csisolatin2", "iso-8859-2", "iso-ir-101", "iso8859-2", "iso88592", "iso_8859-2", "iso_8859-2:1987", "l2", "latin2", "cp1250", "x-cp1250", "windows-1250", "csisolatin3", "iso-8859-3", "iso-ir-109", "iso8859-3", "iso88593", "iso_8859-3", "iso_8859-3:1988", "l3", "latin3", "csisolatin4", "iso-8859-4", "iso-ir-110", "iso8859-4", "iso88594", "iso_8859-4", "iso_8859-4:1988", "l4", "latin4", "cp1257", "windows-1257", "csisolatin5", "iso-8859-5", "iso-ir-144", "iso8859-5", "iso88595", "iso_8859-5", "iso_8859-5:1988", "csisolatincyrillic", "cyrillic", "csisolatingreek", "greek", "greek8", "iso-8859-7", "iso-ir-126", "iso8859-7", "iso88597", "iso_8859-7", "iso_8859-7:1987", "l7", "latin-greek", "csisolatin6", "iso-8859-10", "iso-ir-157", "iso8859-10", "iso885910", "l6", "latin6", "iso-8859-13", "iso8859-13", "iso885913", "csisolatin9", "iso-8859-15", "iso8859-15", "iso885915", "iso_8859-15", "l9", "latin9", "iso-8859-16", "iso8859-16", "iso885916", "cp1256", "x-cp1256", "windows-1256", "cp1254", "x-cp1254", "windows-1254", "cp1253", "x-cp1253", "windows-1253", "cp1255", "x-cp1255", "windows-1255", "cp1258", "x-cp1258", "windows-1258"] },
  { group: "Cyrillic", labels: ["csibm855", "cp855", "855", "ibm855", "csibm866", "cp866", "866", "ibm866", "cskoi8r", "koi", "koi8", "koi8-r", "koi8_r", "koi8-ru", "koi8-u", "csmacintosh", "mac", "macintosh", "x-mac-cyrillic", "x-mac-ukrainian", "x-mac-russian"] },
  { group: "Mac Roman family", labels: ["macroman", "x-mac-roman", "mac-roman", "x-mac-centraleurroman", "x-mac-greek", "x-mac-turkish", "x-mac-icelandic", "x-mac-croatian", "x-mac-romanian"] },
  { group: "Japanese", labels: ["cseucpkdfmtjapanese", "euc-jp", "x-euc-jp", "csiso2022jp", "iso-2022-jp", "shift-jis", "ms932", "ms_kanji", "sjis", "x-sjis", "csshiftjis", "windows-31j", "x-ms-cp932", "cp932"] },
  { group: "Chinese", labels: ["csgb2312", "gb2312", "gb_2312", "gb_2312-80", "gbk", "ms936", "x-gbk", "gb18030", "big5", "big5-hkscs", "cn-big5", "csbig5", "x-x-big5", "x-big5"] },
  { group: "Korean", labels: ["cseuckr", "euc-kr", "iso-ir-149", "korean", "ks_c_5601", "ks_c_5601-1987", "ksc5601", "ksc_5601", "windows-949", "csiso2022kr", "iso-2022-kr"] },
  { group: "Thai / Vietnamese / other", labels: ["dos-874", "iso-8859-11", "iso8859-11", "iso885911", "tis-620", "windows-874", "cp874", "x-user-defined", "x-dos-cp874"] },
  { group: "IBM / DOS legacy", labels: ["cp437", "ibm437", "437", "cspc8codepage437", "cp850", "ibm850", "850", "cspc850multilingual", "cp852", "ibm852", "852", "cp858", "cp860", "ibm860", "860", "cp861", "ibm861", "861", "cp862", "ibm862", "862", "cspc862latinhebrew", "cp863", "ibm863", "863", "cp864", "ibm864", "864", "csibm864", "cp865", "ibm865", "865"] },
];

/** Count of distinct charset labels supported at runtime by TextDecoder. */
export function countSupportedEncodings(labels: string[]): number {
  let n = 0;
  for (const g of labels) {
    try { new TextDecoder(g); n++; } catch { /* unsupported */ }
  }
  return n;
}

/* ---------------------------------- CP437 --------------------------------- */

const CP437_HIGH: string[] = [
  "Ç", "ü", "é", "â", "ä", "à", "å", "ç", "ê", "ë", "è", "ï", "î", "ì", "Ä", "Å",
  "É", "æ", "Æ", "ô", "ö", "ò", "û", "ù", "ÿ", "Ö", "Ü", "¢", "£", "¥", "₧", "ƒ",
  "á", "í", "ó", "ú", "ñ", "Ñ", "ª", "º", "¿", "⌐", "¬", "½", "¼", "¡", "«", "»",
  "░", "▒", "▓", "│", "┤", "╡", "╢", "╖", "╕", "╣", "║", "╗", "╝", "╜", "╛", "┐",
  "└", "┴", "┬", "├", "─", "┼", "╞", "╟", "╚", "╔", "╩", "╦", "╠", "═", "╬", "╧",
  "╨", "╤", "╥", "╙", "╘", "╒", "╓", "╫", "╪", "┘", "┌", "█", "▄", "▌", "▐", "▀",
  "α", "ß", "Γ", "π", "Σ", "σ", "µ", "τ", "Φ", "Θ", "Ω", "δ", "∞", "φ", "ε", "∩",
  "≡", "±", "≥", "≤", "⌠", "⌡", "÷", "≈", "°", "∙", "·", "√", "ⁿ", "²", "■", " ",
];

export function decodeCP437(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  }
  return s;
}

/* ---------------------------------- misc ----------------------------------- */

export function downloadBlob(data: BlobPart, filename: string, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function humanBitsPerByte(h: number): string {
  if (h > 7.2) return "high — likely compressed/encrypted";
  if (h > 5.5) return "elevated — packed data";
  if (h > 4) return "medium — structured binary";
  if (h > 2) return "low-medium — mixed content";
  return "low — plain data / text";
}
