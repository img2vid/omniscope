"use client";

import * as React from "react";
import { inflateSync, gunzipSync, zip as zipAsync, zipSync } from "fflate";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, ToolButton, Segmented,
} from "./viewer-ui";
import {
  cn, formatBytes, formatNum, formatDate, downloadBlob,
  printabilityRatio, isLikelyValidUtf8, decodeCP437, latin1, hexDumpLine,
} from "@/lib/utils";
import { u16le, u32le, asciiAt } from "@/lib/binary";
import {
  Archive, File as FileIcon, Folder, Search, Download, X, Lock, Package, Coffee, GripVertical,
  Disc, Info, FileWarning, ChevronRight, FileText, FileArchive, ExternalLink, ListChecks,
  Loader2, SquareCheckBig,
} from "lucide-react";

/* ================================ model ================================ */

interface ArcEntry {
  path: string;
  isDir: boolean;
  size: number;
  packed: number;
  method: string;
  crc: number | null;
  encrypted: boolean;
  mtime: number | null;
  /** returns decompressed bytes; throws with a readable message */
  read?: () => Uint8Array<ArrayBuffer>;
}

interface GzMeta {
  inner: string;
  originalName?: string;
  mtime: number | null;
  os: string;
  flags: string[];
}

interface IsoMeta {
  sysId: string;
  volId: string;
  volSpace: number;
  blockSize: number;
  joliet: boolean;
}

interface ArchiveModel {
  kind: "zip" | "tar" | "gz" | "iso" | "rar" | "7z";
  subKind?: string;
  entries: ArcEntry[];
  comment?: string;
  bad?: number;
  tailOnly?: boolean;
  gz?: GzMeta;
  iso?: IsoMeta;
  rar?: { version: string; note: string };
  z7?: { version: string; nextHeaderOffset: number; nextHeaderSize: number };
  warnings: string[];
}

interface ByteSource {
  bytes: Uint8Array<ArrayBuffer>;
  /** absolute file offset of bytes[0] */
  base: number;
  total: number;
}

/* ============================== constants ============================== */

const ZIP_METHODS: Record<number, string> = {
  0: "Stored", 1: "Shrunk", 2: "Reduced-1", 3: "Reduced-2", 4: "Reduced-3", 5: "Reduced-4",
  6: "Imploded", 8: "Deflate", 9: "Deflate64", 12: "Bzip2", 14: "LZMA", 51: "WavPack",
  93: "Zstandard", 95: "XZ", 96: "JPEG", 98: "PPMd", 99: "AES",
};

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png", apng: "image/apng", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon", cur: "image/x-icon",
  avif: "image/avif", tif: "image/tiff", tiff: "image/tiff",
};

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "xml", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "csv", "tsv", "log", "yml", "yaml", "toml", "ini", "cfg", "conf", "nfo", "srt", "vtt", "ass", "ssa",
  "sql", "py", "rb", "sh", "bash", "zsh", "c", "h", "cpp", "hpp", "rs", "go", "java", "kt", "swift",
  "properties", "mf", "manifest", "plist", "gitignore", "gitattributes", "env", "svg", "tex", "bib",
  "rst", "adoc", "bat", "cmd", "ps1", "php", "pl", "lua", "diff", "patch", "lock", "license", "readme",
]);

const GZ_OS: Record<number, string> = {
  0: "FAT / MS-DOS", 1: "Amiga", 2: "VMS", 3: "Unix", 4: "VM/CMS", 5: "Atari TOS", 6: "HPFS",
  7: "Macintosh", 8: "Z-System", 9: "CP/M", 10: "TOPS-20", 11: "NTFS", 12: "QDOS", 13: "Acorn RISC OS", 255: "unknown",
};

const PREVIEW_CAP = 2 * 1024 * 1024;

/** total uncompressed bytes allowed for a selection re-pack */
const EXTRACT_PACK_CAP = 512 * 1024 * 1024;

/** sync re-pack cap for drag-out — kept small so the drag never janks (store-only zip) */
const DRAG_ZIP_CAP = 48 * 1024 * 1024;

/** payloads that are already compressed — re-pack uses stored (level 0) when they dominate */
const COMPRESSED_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "zip", "gz", "bz2", "xz", "zst", "lz4",
  "7z", "rar", "mp4", "m4v", "mkv", "webm", "mov", "avi", "mp3", "flac", "ogg", "opus", "aac",
  "woff", "woff2", "ttf", "otf", "pdf", "docx", "xlsx", "pptx", "epub", "jar", "apk", "dex",
  "class", "wasm", "iso", "img", "bin", "cab", "msi",
]);

/* ============================== byte helpers ============================== */

function u64le(b: Uint8Array, o: number): number {
  // 64-bit LE as a Number (precise up to 2^53 — enough for file offsets)
  let v = 0;
  for (let i = 7; i >= 0; i--) v = v * 256 + (b[o + i] ?? 0);
  return v;
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i + 1) : "";
}

function dosDateTime(time: number, date: number): number | null {
  if (!date && !time) return null;
  const year = ((date >> 9) & 0x7f) + 1980;
  const mon = ((date >> 5) & 0x0f) || 1;
  const day = (date & 0x1f) || 1;
  const h = (time >> 11) & 0x1f;
  const m = (time >> 5) & 0x3f;
  const s = (time & 0x1f) * 2;
  const d = new Date(Date.UTC(year, mon - 1, day, h, m, s));
  return isNaN(d.getTime()) ? null : d.getTime();
}

/* ================================= ZIP ================================= */

function parseZip(src: ByteSource): ArchiveModel {
  const b = src.bytes;
  const n = b.length;
  const warnings: string[] = [];
  const scanFrom = Math.max(0, n - 66000);
  let eocd = -1;
  for (let i = n - 22; i >= scanFrom; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new Error("ZIP: end of central directory not found — the file may be truncated or part of a multi-part set.");
  }
  let count = u16le(b, eocd + 10);
  let cdSize = u32le(b, eocd + 12);
  let cdOffset = u32le(b, eocd + 16);
  const commentLen = u16le(b, eocd + 20);
  const comment = commentLen ? latin1(b.subarray(eocd + 22, eocd + 22 + commentLen)).trim() : "";

  // ZIP64 fallback
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    for (let i = eocd - 20; i >= scanFrom; i--) {
      if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x06 && b[i + 3] === 0x07) {
        const z64abs = u64le(b, i + 8);
        const z = z64abs - src.base;
        if (z >= 0 && z + 56 <= n && b[z] === 0x50 && b[z + 1] === 0x4b && b[z + 2] === 0x06 && b[z + 3] === 0x06) {
          count = u64le(b, z + 32);
          cdSize = u64le(b, z + 40);
          cdOffset = u64le(b, z + 48);
          warnings.push("ZIP64 layout (over 4 GB addressing) detected.");
        }
        break;
      }
    }
  }

  // locate the central directory inside the loaded window
  let cd = -1;
  for (const c of [cdOffset - src.base, cdOffset]) {
    if (c >= 0 && c + 4 <= n && u32le(b, c) === 0x02014b50) { cd = c; break; }
  }
  if (cd < 0) {
    const c = eocd - cdSize;
    if (c >= 0 && c + 4 <= n && u32le(b, c) === 0x02014b50) {
      cd = c;
      warnings.push("Archive has prepended data (self-extracting / wrapped ZIP) — offsets adjusted.");
    }
  }
  if (cd < 0) throw new Error("ZIP: central directory not present inside the loaded bytes.");
  if (src.base > 0) {
    warnings.push("Directory-only mode: the file body was not loaded (over the in-memory cap) — entry previews and downloads are unavailable.");
  }

  const entries: ArcEntry[] = [];
  let off = cd;
  let bad = 0;
  const limit = Math.min(count, 100000);
  for (let i = 0; i < limit; i++) {
    if (off + 46 > n) break;
    if (u32le(b, off) !== 0x02014b50) { bad++; break; }
    const flags = u16le(b, off + 8);
    const method = u16le(b, off + 10);
    const time = u16le(b, off + 12);
    const date = u16le(b, off + 14);
    const crc = u32le(b, off + 16);
    let packed = u32le(b, off + 20);
    let size = u32le(b, off + 24);
    const nameLen = u16le(b, off + 28);
    const extraLen = u16le(b, off + 30);
    const entryCommentLen = u16le(b, off + 32);
    let local = u32le(b, off + 42);
    const extAttr = u32le(b, off + 38);
    if (off + 46 + nameLen > n) { bad++; break; }
    const name = flags & 0x800
      ? new TextDecoder().decode(b.subarray(off + 46, off + 46 + nameLen))
      : decodeCP437(b.subarray(off + 46, off + 46 + nameLen));

    // ZIP64 extra field
    let eo = off + 46 + nameLen;
    const eEnd = Math.min(eo + extraLen, n);
    while (eo + 4 <= eEnd) {
      const id = u16le(b, eo);
      const sz = u16le(b, eo + 2);
      if (id === 0x0001) {
        let p = eo + 4;
        if (size === 0xffffffff && p + 8 <= eEnd) { size = u64le(b, p); p += 8; }
        if (packed === 0xffffffff && p + 8 <= eEnd) { packed = u64le(b, p); p += 8; }
        if (local === 0xffffffff && p + 8 <= eEnd) { local = u64le(b, p); p += 8; }
      }
      eo += 4 + sz;
    }

    off += 46 + nameLen + extraLen + entryCommentLen;
    if (!name) { bad++; continue; }
    const isDir = name.endsWith("/") || (extAttr & 0x10) !== 0 || ((extAttr >>> 16) & 0xf000) === 0x4000;
    const encrypted = (flags & 1) !== 0;
    entries.push({
      path: name,
      isDir,
      size,
      packed,
      method: ZIP_METHODS[method] ?? `method ${method}`,
      crc: isDir ? null : crc,
      encrypted,
      mtime: dosDateTime(time, date),
      read: isDir || encrypted ? undefined : () => readZipEntry(src, local, packed, method),
    });
  }
  if (count > limit) warnings.push(`Entry list capped at ${limit} of ${count} records.`);
  return { kind: "zip", entries, comment: comment || undefined, bad, warnings, tailOnly: src.base > 0 };
}

function readZipEntry(src: ByteSource, local: number, packed: number, method: number): Uint8Array<ArrayBuffer> {
  const b = src.bytes;
  const off = local - src.base;
  if (off < 0 || off + 30 > b.length) {
    throw new Error("Entry data lies outside the loaded byte window (file exceeds the in-memory cap).");
  }
  if (u32le(b, off) !== 0x04034b50) throw new Error("Local header mismatch — unsupported archive layout.");
  const nameLen = u16le(b, off + 26);
  const extraLen = u16le(b, off + 28);
  const start = off + 30 + nameLen + extraLen;
  if (start + packed > b.length) throw new Error("Compressed data incomplete inside the loaded window.");
  const data = b.subarray(start, start + packed);
  if (method === 0) return data;
  if (method === 8) return inflateSync(data);
  throw new Error(`Compression method “${ZIP_METHODS[method] ?? method}” is not decodable in-browser yet.`);
}

/* ================================= TAR ================================= */

function parseOctal(field: Uint8Array): number {
  if (field.length && (field[0] & 0x80) !== 0) {
    // GNU base-256 extension
    let v = field[0] & 0x7f;
    for (let i = 1; i < field.length; i++) v = v * 256 + field[i];
    return v;
  }
  let s = "";
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    if (c === 0) break;
    if (c !== 0x20) s += String.fromCharCode(c);
  }
  if (!/^[0-7]*$/.test(s)) return 0;
  const v = parseInt(s, 8);
  return isNaN(v) ? 0 : v;
}

function tarCStr(field: Uint8Array): string {
  let s = "";
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function tarChecksumOk(h: Uint8Array): boolean {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  const stored = parseOctal(h.subarray(148, 156));
  return stored > 0 && sum === stored;
}

function parseTar(b: Uint8Array<ArrayBuffer>): { entries: ArcEntry[]; variant: string } {
  const entries: ArcEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  const magic = asciiAt(b, 257, 5);
  const variant = magic === "ustar" ? (b[263] === 0x00 ? "ustar (POSIX)" : b[263] === 0x20 ? "ustar (GNU)" : "ustar") : "pre-POSIX (v7)";
  const CAP = 25000;
  while (off + 512 <= b.length && entries.length < CAP) {
    const h = b.subarray(off, off + 512);
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[511] === 0) break; // end-of-archive zero block
    if (asciiAt(h, 257, 5) !== "ustar" && !tarChecksumOk(h)) break; // not a header
    const type = h[156];
    const size = parseOctal(h.subarray(124, 136));
    const mtime = parseOctal(h.subarray(136, 148)) * 1000;
    const dataStart = off + 512;
    const name = longName ?? paxPath ?? (() => {
      const base = tarCStr(h.subarray(0, 100));
      const prefix = magic === "ustar" ? tarCStr(h.subarray(345, 500)) : "";
      return prefix ? prefix + "/" + base : base;
    })();
    longName = null;
    paxPath = null;

    if (type === 0x4c) { // GNU long name — payload is the name of the NEXT entry
      longName = tarCStr(b.subarray(dataStart, dataStart + Math.min(size, 4096)));
      off = dataStart + Math.ceil(size / 512) * 512;
      continue;
    }
    if (type === 0x78 || type === 0x67) { // pax extended / global header
      const text = latin1(b.subarray(dataStart, dataStart + Math.min(size, 65536)));
      const at = text.indexOf(" path=");
      if (at >= 0) {
        const rest = text.slice(at + 6);
        const nl = rest.indexOf("\n");
        paxPath = nl >= 0 ? rest.slice(0, nl) : rest;
      }
      off = dataStart + Math.ceil(size / 512) * 512;
      continue;
    }

    const kind = type === 0 ? "0" : String.fromCharCode(type);
    const isDir = kind === "5" || (name.endsWith("/") && kind === "0");
    const special: Record<string, string> = { "1": "hard link", "2": "symlink", "3": "char device", "4": "block device", "6": "FIFO" };
    entries.push({
      path: name,
      isDir,
      size: isDir ? 0 : size,
      packed: size,
      method: isDir ? "directory" : kind === "0" || kind === "7" ? "stored" : special[kind] ?? `type ${kind}`,
      crc: null,
      encrypted: false,
      mtime: mtime || null,
      read: !isDir && (kind === "0" || kind === "7")
        ? () => b.subarray(dataStart, Math.min(dataStart + size, b.length))
        : undefined,
    });
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return { entries, variant };
}

/* ================================= ISO ================================= */

function isoStr(b: Uint8Array, o: number, n: number): string {
  return latin1(b.subarray(o, o + n)).replace(/[\0 ]+$/g, "");
}

function parseIso(b: Uint8Array<ArrayBuffer>): ArchiveModel {
  let pvd = -1;
  let joliet = false;
  let off = 0x8000;
  for (let i = 0; i < 16 && off + 2048 <= b.length; i++) {
    const type = b[off];
    if (asciiAt(b, off + 1, 5) !== "CD001") break;
    if (type === 1 && pvd < 0) pvd = off;
    else if (type === 2) joliet = true;
    else if (type === 255) break;
    off += 2048;
  }
  if (pvd < 0) throw new Error("ISO9660: no primary volume descriptor found at sector 16.");
  const p = b.subarray(pvd, pvd + 2048);
  const iso: IsoMeta = {
    sysId: isoStr(b, pvd + 8, 32),
    volId: isoStr(b, pvd + 40, 32),
    volSpace: u32le(p, 80),
    blockSize: u16le(p, 128) || 2048,
    joliet,
  };
  const rootExtent = u32le(p, 158);
  const rootLen = u32le(p, 166);
  const entries: ArcEntry[] = [];
  const warnings: string[] = [];
  let depthCapped = false;

  const walk = (extent: number, len: number, prefix: string, depth: number) => {
    if (entries.length >= 5000) return;
    const start = extent * iso.blockSize;
    if (start < 0 || start >= b.length) return;
    const end = Math.min(start + len, b.length);
    let o = start;
    while (o + 34 <= end) {
      const recLen = b[o];
      if (recLen === 0) { // records never cross sector boundaries — skip to next sector
        const next = (Math.floor(o / iso.blockSize) + 1) * iso.blockSize;
        if (next <= o) break;
        o = next;
        continue;
      }
      if (recLen < 34 || o + recLen > end) break;
      const ext = u32le(b, o + 2);
      const dlen = u32le(b, o + 10);
      const flags = b[o + 25];
      const nameLen = b[o + 32];
      const name = latin1(b.subarray(o + 33, o + 33 + nameLen));
      o += recLen;
      if (name === "\u0000" || name === "\u0001") continue; // . and ..
      const clean = name.replace(/;\d+$/, "");
      const path = prefix ? prefix + "/" + clean : clean;
      const isDir = (flags & 0x02) !== 0;
      if (isDir) {
        entries.push({
          path, isDir: true, size: 0, packed: 0, method: "directory", crc: null, encrypted: false, mtime: null,
        });
        if (depth < 2) walk(ext, dlen, path, depth + 1);
        else depthCapped = true;
      } else {
        const dataStart = ext * iso.blockSize;
        entries.push({
          path, isDir: false, size: dlen, packed: dlen, method: "ISO9660", crc: null, encrypted: false, mtime: null,
          read: dataStart >= b.length ? undefined
            : () => b.subarray(dataStart, Math.min(dataStart + dlen, b.length)),
        });
      }
    }
  };
  walk(rootExtent, rootLen, "", 0);
  if (depthCapped) warnings.push("Directory walk capped at 2 levels — deeper sub-folders are listed but not expanded.");
  if (joliet) warnings.push("Joliet (UCS-2) supplementary volume detected — showing primary ISO9660 names.");
  return { kind: "iso", entries, iso, warnings };
}

/* ================================= GZ ================================= */

function parseGzHeader(b: Uint8Array): GzMeta {
  if (b.length < 10) throw new Error("GZIP: header truncated.");
  const flg = b[3];
  const mtime = u32le(b, 4);
  let o = 10;
  if (flg & 4) o += 2 + u16le(b, o);
  let originalName: string | undefined;
  if (flg & 8) {
    const e = b.indexOf(0, o);
    if (e > o) originalName = latin1(b.subarray(o, e));
    o = (e < 0 ? o : e) + 1;
  }
  const flags: string[] = [];
  if (flg & 1) flags.push("FTEXT");
  if (flg & 2) flags.push("FHCRC");
  if (flg & 4) flags.push("FEXTRA");
  if (flg & 8) flags.push("FNAME");
  if (flg & 16) flags.push("FCOMMENT");
  return { inner: "", originalName, mtime: mtime ? mtime * 1000 : null, os: GZ_OS[b[9]] ?? `unknown (${b[9]})`, flags };
}

function parseGz(src: ByteSource, fileName: string): ArchiveModel {
  const b = src.bytes;
  const gz = parseGzHeader(b);
  let inner: Uint8Array<ArrayBuffer>;
  try {
    inner = gunzipSync(b);
  } catch (e) {
    throw new Error("GZIP: decompression failed (" + (e instanceof Error ? e.message : String(e)) + "). The stream may be corrupted or multi-member.");
  }
  const warnings: string[] = [];
  if (inner.length >= 262 && asciiAt(inner, 257, 5) === "ustar") {
    const t = parseTar(inner);
    return { kind: "gz", subKind: `TAR (${t.variant})`, entries: t.entries, gz: { ...gz, inner: "TAR archive" }, warnings };
  }
  if (inner[0] === 0x50 && inner[1] === 0x4b) {
    try {
      const z = parseZip({ bytes: inner, base: 0, total: inner.length });
      return { kind: "gz", subKind: "ZIP", entries: z.entries, comment: z.comment, gz: { ...gz, inner: "ZIP archive" }, warnings };
    } catch { /* fall through to raw content */ }
  }
  if (inner.length >= 0x8006 && asciiAt(inner, 0x8001, 5) === "CD001") {
    try {
      const m = parseIso(inner);
      return { kind: "gz", subKind: "ISO", entries: m.entries, gz: { ...gz, inner: "ISO image" }, warnings: m.warnings };
    } catch { /* fall through */ }
  }
  const name = gz.originalName || fileName.replace(/\.(t?gz|gzip)$/i, "") || "content";
  const probe = inner.subarray(0, Math.min(inner.length, 2048));
  const texty = printabilityRatio(probe) > 0.9;
  if (texty) warnings.push("Inner content looks like text — preview uses UTF-8 with CP437 fallback.");
  return {
    kind: "gz",
    subKind: texty ? "text" : "binary",
    entries: [{
      path: name, isDir: false, size: inner.length, packed: b.length, method: "gzip",
      crc: null, encrypted: false, mtime: gz.mtime, read: () => inner,
    }],
    gz: { ...gz, inner: texty ? "Text content" : "Binary content" },
    warnings,
  };
}

/* =============================== RAR / 7z =============================== */

function parseRar(b: Uint8Array): ArchiveModel {
  const v5 = b.length > 7 && b[6] === 1;
  return {
    kind: "rar",
    entries: [],
    rar: {
      version: v5 ? "RAR 5.0+" : "RAR 4.x",
      note: v5
        ? "RAR5 uses a proprietary dictionary codec — entry listing and extraction are not available in-browser yet."
        : "RAR4 uses a proprietary compression codec — entry listing and extraction are not available in-browser yet.",
    },
    warnings: [],
  };
}

function parse7z(b: Uint8Array): ArchiveModel {
  return {
    kind: "7z",
    entries: [],
    z7: {
      version: `${b[6]}.${b[7]}`,
      nextHeaderOffset: u64le(b, 12),
      nextHeaderSize: u64le(b, 20),
    },
    warnings: [],
  };
}

/* ============================== dispatcher ============================== */

function parseArchive(src: ByteSource, fileName: string): ArchiveModel {
  const b = src.bytes;
  if (b.length >= 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)) {
    return parseZip(src);
  }
  if (b.length >= 7 && asciiAt(b, 0, 4) === "Rar!") return parseRar(b);
  if (b.length >= 6 && asciiAt(b, 0, 2) === "7z" && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c) {
    return parse7z(b);
  }
  if (b.length >= 0x8006 && asciiAt(b, 0x8001, 5) === "CD001") return parseIso(b);
  if (b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b) return parseGz(src, fileName);
  if (b.length >= 512 && (asciiAt(b, 257, 5) === "ustar" || tarChecksumOk(b.subarray(0, 512)))) {
    const t = parseTar(b);
    return { kind: "tar", subKind: t.variant, entries: t.entries, warnings: [] };
  }
  throw new Error("Archive structure not recognized (supported listing: ZIP, TAR, GZ/TGZ, ISO 9660; detection only: RAR, 7z).");
}

/* ============================== entry panel ============================== */

function EntryPanel({ entry, onClose, onOpenFile }: { entry: ArcEntry; onClose: () => void; onOpenFile?: (f: File) => void }) {
  const [data, setData] = React.useState<Uint8Array<ArrayBuffer> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"auto" | "text" | "hex">("auto");
  const [imgUrl, setImgUrl] = React.useState<string | null>(null);
  const [imgError, setImgError] = React.useState(false);

  const ext = extOf(entry.path);
  const imageType = IMAGE_TYPES[ext];

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    setData(null);
    setImgUrl(null);
    setImgError(false);
    setMode("auto");
    if (!entry.read) return;
    if (entry.size > PREVIEW_CAP) {
      setError(`Preview capped — the entry decompresses to ${formatBytes(entry.size)} (limit ${formatBytes(PREVIEW_CAP)}). Use Download to extract it fully.`);
      return;
    }
    try {
      const d = entry.read();
      if (!cancelled) setData(d);
    } catch (e) {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }
    return () => { cancelled = true; };
  }, [entry]);

  React.useEffect(() => {
    if (!data || !imageType || imgError) { setImgUrl(null); return; }
    const url = URL.createObjectURL(new Blob([data.slice()], { type: imageType }));
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data, imageType, imgError]);

  const textPreview = React.useMemo(() => {
    if (!data) return "";
    const utf8 = isLikelyValidUtf8(data.subarray(0, Math.min(data.length, 8192)));
    const s = utf8 ? new TextDecoder().decode(data.subarray(0, Math.min(data.length, 200_000))) : decodeCP437(data.subarray(0, Math.min(data.length, 200_000)));
    return data.length > 200_000 ? s + "\n… (truncated after 200 KB)" : s;
  }, [data]);

  const isTexty = React.useMemo(() => {
    if (!data) return false;
    if (TEXT_EXTS.has(ext)) return true;
    return printabilityRatio(data.subarray(0, 2048)) > 0.9;
  }, [data, ext]);

  const hexLines = React.useMemo(() => {
    if (!data) return [] as string[];
    const chunk = data.subarray(0, 4096);
    const out: string[] = [];
    for (let i = 0; i < chunk.length; i += 16) out.push(hexDumpLine(chunk.subarray(i, i + 16), i));
    return out;
  }, [data]);

  const effective: "image" | "text" | "hex" =
    mode === "auto" ? (imgUrl ? "image" : isTexty ? "text" : "hex") : mode;

  function handleDownload() {
    try {
      if (!entry.read) throw new Error("This entry cannot be extracted.");
      const d = entry.read();
      downloadBlob(d.slice(), baseOf(entry.path) || "entry", imageType ?? "application/octet-stream");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleOpen() {
    try {
      if (!entry.read) throw new Error("This entry cannot be extracted.");
      const d = entry.read();
      onOpenFile?.(new File([d.slice()], baseOf(entry.path) || "entry", { type: imageType ?? "application/octet-stream" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <SectionCard
      title={baseOf(entry.path) || entry.path}
      icon={<FileIcon className="h-3.5 w-3.5" />}
      right={
        <div className="flex items-center gap-1">
          {onOpenFile && entry.read ? (
            <ToolButton label="Open" onClick={handleOpen} title="Extract and open in Omniscope as a new tab">
              <ExternalLink className="h-3.5 w-3.5" />
            </ToolButton>
          ) : null}
          <ToolButton label="Download" onClick={handleDownload} disabled={!entry.read} title="Download this entry">
            <Download className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton onClick={onClose} title="Close preview"><X className="h-3.5 w-3.5" /></ToolButton>
        </div>
      }
      className="self-start"
    >
      <InfoGrid className="mb-3">
        <Field label="Path" mono>{entry.path}</Field>
        <Field label="Size">{formatBytes(entry.size)}{entry.size >= 1000 ? ` (${formatNum(entry.size)} B)` : ""}</Field>
        {entry.packed !== entry.size ? <Field label="Packed">{formatBytes(entry.packed)}</Field> : null}
        <Field label="Method">{entry.method}</Field>
        {entry.crc != null ? <Field label="CRC-32" mono>{entry.crc.toString(16).toUpperCase().padStart(8, "0")}</Field> : null}
        {entry.mtime ? <Field label="Modified">{formatDate(entry.mtime)}</Field> : null}
      </InfoGrid>

      {entry.encrypted ? (
        <div className="rounded border border-amber-900/50 bg-amber-950/20 p-3 text-center text-xs text-amber-300">
          <Lock className="mx-auto mb-1 h-4 w-4" />
          Encrypted entry (general-purpose flag bit 0). Password-protected archives cannot be decrypted in this viewer.
        </div>
      ) : error ? (
        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-400">{error}</div>
      ) : !data ? (
        <EmptyHint>Nothing to preview for this entry.</EmptyHint>
      ) : (
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "auto", label: "Auto" },
                { value: "text", label: "Text" },
                { value: "hex", label: "Hex" },
              ]}
            />
            <Chip>{effective === "image" ? "image" : effective === "text" ? `${formatBytes(Math.min(data.length, 200_000))} text` : "first 4 KB"}</Chip>
          </div>
          {effective === "image" ? (
            imgUrl ? (
              <div
                className="flex max-h-[46vh] items-center justify-center overflow-auto rounded border border-zinc-800 scrollbar-thin"
                style={{
                  backgroundImage: "conic-gradient(#27272a 25%, #18181b 0 50%, #27272a 0 75%, #18181b 0)",
                  backgroundSize: "16px 16px",
                }}
              >
                { }
                <img src={imgUrl} alt={entry.path} className="max-h-[46vh] w-auto max-w-full" onError={() => setImgError(true)} />
              </div>
            ) : (
              <EmptyHint>Rendering image…</EmptyHint>
            )
          ) : null}
          {effective === "text" ? (
            <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-950/70 p-2 font-mono text-[11px] leading-relaxed text-zinc-300 scrollbar-thin">
              {textPreview || "(empty file)"}
            </pre>
          ) : null}
          {effective === "hex" ? (
            <div className="max-h-[46vh] overflow-auto rounded border border-zinc-800 bg-zinc-950/70 p-2 font-mono text-[10px] leading-relaxed text-zinc-400 scrollbar-thin">
              {hexLines.map((l, i) => (
                <div key={i} className="whitespace-pre">{l}</div>
              ))}
              {data.length > 4096 ? <div className="whitespace-pre text-zinc-600">… ({formatBytes(data.length)} total — first 4 KB shown)</div> : null}
            </div>
          ) : null}
          {imgError && mode === "auto" && isTexty ? (
            <div className="mt-2 text-[11px] text-zinc-500">Image could not be decoded — showing text/hex fallback.</div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

/* ============================== info card ============================== */

function ArchiveInfoCard({ model, fileName }: { model: ArchiveModel; fileName: string }) {
  const methodCounts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const e of model.entries) if (!e.isDir) m.set(e.method, (m.get(e.method) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [model]);

  return (
    <SectionCard title="Archive info" icon={<Info className="h-3.5 w-3.5" />} className="self-start">
      <InfoGrid>
        {model.gz ? (
          <>
            <Field label="Inner format">{model.gz.inner}{model.subKind ? ` — ${model.subKind}` : ""}</Field>
            {model.gz.originalName ? <Field label="Original name" mono>{model.gz.originalName}</Field> : null}
            <Field label="GZIP mtime">{model.gz.mtime ? formatDate(model.gz.mtime) : "—"}</Field>
            <Field label="Made on">{model.gz.os}</Field>
            {model.gz.flags.length ? <Field label="Flags">{model.gz.flags.join(", ")}</Field> : null}
          </>
        ) : null}
        {model.iso ? (
          <>
            <Field label="Volume ID" mono>{model.iso.volId || "—"}</Field>
            <Field label="System" mono>{model.iso.sysId || "—"}</Field>
            <Field label="Block size">{formatNum(model.iso.blockSize)} B</Field>
            <Field label="Volume space">{formatNum(model.iso.volSpace)} blocks ({formatBytes(model.iso.volSpace * model.iso.blockSize)})</Field>
            <Field label="Joliet">{model.iso.joliet ? "supplementary volume present" : "no"}</Field>
          </>
        ) : null}
        {model.kind === "tar" && model.subKind ? <Field label="TAR variant">{model.subKind}</Field> : null}
        <Field label="File">{fileName}</Field>
        {model.comment ? <Field label="Comment">{model.comment}</Field> : null}
      </InfoGrid>
      {methodCounts.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-3">
          {methodCounts.slice(0, 8).map(([m, c]) => (
            <Chip key={m}>{m} × {formatNum(c)}</Chip>
          ))}
        </div>
      ) : null}
      <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] leading-relaxed text-zinc-400">
        Click any file entry to preview, download, or open it in Omniscope — drag an entry out to save it
        directly, or tick several to extract them in bulk / re-pack as a new ZIP. Dragging a ticked row carries
        every ticked entry out as one <span className="font-mono text-zinc-300">-selection.zip</span>. Everything
        happens locally in your browser.
      </p>
    </SectionCard>
  );
}

/* ============================== main viewer ============================== */

function UnsupportedCodecCard({ model }: { model: ArchiveModel }) {
  const is7z = model.kind === "7z";
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <SectionCard title={is7z ? "7-Zip archive" : "RAR archive"} icon={<FileWarning className="h-3.5 w-3.5" />}>
        <InfoGrid>
          <Field label="Format">{is7z ? "7z (LZMA/LZMA2 family)" : model.rar?.version}</Field>
          <Field label="Signature" mono>{is7z ? "37 7A BC AF 27 1C" : "52 61 72 21 1A 07"}</Field>
          {is7z && model.z7 ? (
            <>
              <Field label="Version">{model.z7.version}</Field>
              <Field label="Next header" mono>offset {formatNum(model.z7.nextHeaderOffset)}, size {formatNum(model.z7.nextHeaderSize)}</Field>
            </>
          ) : null}
        </InfoGrid>
        <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-300">
          {is7z
            ? "7z header metadata parsed, but the entry list lives in the compressed “next header” block (LZMA). In-browser extraction for this codec is not available yet."
            : model.rar?.note}
          {" "}Switch to the Hex view from the app toolbar for byte-level inspection.
        </div>
      </SectionCard>
    </div>
  );
}

export default function ArchiveViewer({ file, arrayBuffer, head, detected, fileName, onOpenFile }: ViewerProps) {
  const [model, setModel] = React.useState<ArchiveModel | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [visible, setVisible] = React.useState(500);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [sel, setSel] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState<null | { kind: "zip" | "download"; done: number; total: number }>(null);
  const [extractError, setExtractError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setModel(null);
    setErr(null);
    setSelected(null);
    setVisible(500);
    setSel(new Set());
    setBusy(null);
    setExtractError(null);
    (async () => {
      try {
        if (arrayBuffer) {
          const bytes = new Uint8Array(arrayBuffer) as Uint8Array<ArrayBuffer>;
          const m = parseArchive({ bytes, base: 0, total: bytes.length }, fileName);
          if (!cancelled) setModel(m);
          return;
        }
        // no full buffer — try a tail window for a ZIP directory-only listing
        if (head.length >= 3 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5 || head[2] === 7)) {
          const tailLen = Math.min(file.size, 6 * 1024 * 1024);
          if (tailLen < 22) throw new Error("File too small to contain a ZIP structure.");
          const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer()) as Uint8Array<ArrayBuffer>;
          const m = parseArchive({ bytes: tail, base: file.size - tail.length, total: file.size }, fileName);
          if (!cancelled) setModel(m);
        } else {
          throw new Error("File exceeds the in-memory load cap (96 MB) and this archive format needs the full stream to be parsed.");
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, file, head, fileName]);

  React.useEffect(() => { setVisible(500); }, [query]);

  const stats = React.useMemo(() => {
    if (!model) return null;
    let files = 0, folders = 0, total = 0, packed = 0, enc = 0;
    for (const e of model.entries) {
      if (e.isDir) folders++; else files++;
      total += e.size;
      packed += e.packed;
      if (e.encrypted) enc++;
    }
    return { files, folders, total, packed, enc };
  }, [model]);

  const containerChips = React.useMemo(() => {
    if (!model) return [] as { label: string; tone: "emerald" | "teal" | "amber" | "zinc" }[];
    const out: { label: string; tone: "emerald" | "teal" | "amber" | "zinc" }[] = [];
    const paths = new Set(model.entries.map((e) => e.path));
    if (paths.has("AndroidManifest.xml")) out.push({ label: "Android package", tone: "emerald" });
    else if (paths.has("META-INF/MANIFEST.MF")) out.push({ label: "Java archive", tone: "teal" });
    if (paths.has("mimetype") && paths.has("META-INF/container.xml")) out.push({ label: "EPUB / ODF container", tone: "zinc" });
    const ext = extOf(fileName);
    if (ext === "cbz" || ext === "cbr") out.push({ label: "Comic archive", tone: "zinc" });
    if (ext === "apk" && !paths.has("AndroidManifest.xml")) out.push({ label: "APK-like", tone: "amber" });
    return out;
  }, [model, fileName]);

  const filtered = React.useMemo(() => {
    if (!model) return [] as ArcEntry[];
    const q = query.trim().toLowerCase();
    if (!q) return model.entries;
    return model.entries.filter((e) => e.path.toLowerCase().includes(q));
  }, [model, query]);

  const selectedEntry = React.useMemo(
    () => (model && selected ? model.entries.find((e) => e.path === selected) ?? null : null),
    [model, selected],
  );

  /* ---------------- bulk extraction ---------------- */

  const extractable = React.useMemo(
    () => !!model && model.entries.some((e) => e.read && !e.encrypted),
    [model],
  );

  const selectable = React.useMemo(
    () => filtered.filter((e) => e.read && !e.encrypted),
    [filtered],
  );

  const selEntries = React.useMemo(
    () => (model ? model.entries.filter((e) => sel.has(e.path) && e.read && !e.encrypted) : []),
    [model, sel],
  );

  const selBytes = selEntries.reduce((a, e) => a + e.size, 0);
  const allSel = selectable.length > 0 && selectable.every((e) => sel.has(e.path));
  const someSel = selectable.some((e) => sel.has(e.path));

  function toggleSel(path: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  }

  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (selectable.every((e) => n.has(e.path))) {
        for (const e of selectable) n.delete(e.path);
      } else {
        for (const e of selectable) n.add(e.path);
      }
      return n;
    });
  }

  function selectAllFiltered() {
    setSel(new Set(selectable.map((e) => e.path)));
  }

  /* ---------------- native drag-out (save an entry by dragging it to the desktop / a folder) ---------------- */

  /** floating badge shown as the drag image when several ticked entries leave as one zip */
  function makeDragBadge(count: number, zipName: string, ev: React.DragEvent): HTMLDivElement {
    const badge = document.createElement("div");
    badge.setAttribute("style", [
      "position: fixed",
      `left: ${Math.max(12, ev.clientX - 46)}px`,
      `top: ${Math.max(12, ev.clientY - 16)}px`,
      "z-index: 2147483647",
      "pointer-events: none",
      "display: flex",
      "flex-direction: column",
      "gap: 1px",
      "padding: 6px 12px",
      "border-radius: 8px",
      "border: 1px solid color-mix(in srgb, var(--color-emerald-500, #10b981) 50%, transparent)",
      "background: color-mix(in srgb, var(--color-emerald-950, #022c22) 96%, black)",
      "color: var(--color-emerald-300, #6ee7b7)",
      "font: 600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      "box-shadow: 0 10px 30px rgba(0,0,0,.55), inset 0 1px 0 color-mix(in srgb, var(--color-emerald-300, #6ee7b7) 12%, transparent)",
    ].join(";"));
    const main = document.createElement("span");
    main.textContent = `${count} ${count === 1 ? "file" : "files"} · zip`;
    const sub = document.createElement("span");
    sub.setAttribute("style", "font-weight:400;font-size:10px;color:var(--color-emerald-200, #a7f3d0);opacity:.75;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
    sub.textContent = zipName;
    badge.append(main, sub);
    document.body.appendChild(badge);
    return badge;
  }

  function handleRowDragStart(ev: React.DragEvent<HTMLTableRowElement>, entry: ArcEntry) {
    if (!entry.read || entry.encrypted) return;
    const dt = ev.dataTransfer;
    dt.effectAllowed = "copy";

    // ticked row + more than one ticked → drag the whole selection out as one zip
    if (sel.has(entry.path) && selEntries.length >= 2 && selBytes <= DRAG_ZIP_CAP) {
      try {
        const files: Record<string, Uint8Array> = {};
        for (const e of selEntries) files[e.path] = e.read!().slice();
        // store-only: the zip must be ready inside this event handler — no time to deflate
        const zipped = zipSync(files, { level: 0, mem: 8 });
        const base = fileName.replace(/\.[a-z0-9]+$/i, "") || "archive";
        const name = `${base}-selection.zip`;
        const url = URL.createObjectURL(new Blob([zipped as unknown as BlobPart], { type: "application/zip" }));
        try {
          // Chromium native "drag out to save"
          dt.setData("DownloadURL", `application/zip:${name}:${url}`);
          dt.setData("text/uri-list", url);
          dt.setData("text/plain", `${selEntries.length} files from ${fileName} → ${name}`);
        } catch { /* some browsers restrict custom types */ }
        const badge = makeDragBadge(selEntries.length, name, ev);
        try { dt.setDragImage(badge, 46, 16); } catch { /* drag image optional */ }
        const kill = () => badge.remove();
        ev.currentTarget.addEventListener("dragend", kill, { once: true });
        window.setTimeout(() => {
          kill();
          URL.revokeObjectURL(url);
        }, 60_000);
        return;
      } catch { /* fall through to a single-entry drag */ }
    }

    let bytes: Uint8Array;
    try {
      bytes = entry.read();
    } catch {
      return; // no payload — plain drag
    }
    const name = baseOf(entry.path) || "entry";
    const mime = IMAGE_TYPES[extOf(entry.path)] ?? "application/octet-stream";
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
    try {
      // Chromium native "drag out to save"
      dt.setData("DownloadURL", `${mime}:${name}:${url}`);
      dt.setData("text/uri-list", url);
      dt.setData("text/plain", name);
    } catch { /* some browsers restrict custom types */ }
    // keep the URL alive long enough for an OS drop, then clean up
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function downloadSelected() {
    if (!selEntries.length || busy) return;
    setExtractError(null);
    const items = selEntries;
    setBusy({ kind: "download", done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        const d = e.read!();
        downloadBlob(d.slice(), baseOf(e.path) || "entry", IMAGE_TYPES[extOf(e.path)] ?? "application/octet-stream");
        setBusy({ kind: "download", done: i + 1, total: items.length });
        if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
      }
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function saveSelectionAsZip() {
    if (!selEntries.length || busy) return;
    setExtractError(null);
    const total = selEntries.reduce((a, e) => a + e.size, 0);
    if (total > EXTRACT_PACK_CAP) {
      setExtractError(
        `Selection decompresses to ${formatBytes(total)} — the re-pack cap is ${formatBytes(EXTRACT_PACK_CAP)}. ` +
        "Download the entries individually instead.",
      );
      return;
    }
    setBusy({ kind: "zip", done: 0, total: selEntries.length });
    // give the UI one frame to show the packaging state before synchronous reads
    setTimeout(() => {
      try {
        const files: Record<string, Uint8Array> = {};
        let alreadyCompressed = 0;
        for (const e of selEntries) {
          files[e.path] = e.read!().slice();
          if (COMPRESSED_EXTS.has(extOf(e.path))) alreadyCompressed += e.size;
        }
        // already-compressed payloads dominate → store instead of deflate (faster, same size)
        const level = total > 0 && alreadyCompressed / total > 0.5 ? 0 : 6;
        zipAsync(files, { level, mem: 8 }, (zerr, data) => {
          setBusy(null);
          if (zerr) {
            setExtractError(String((zerr as Error)?.message ?? zerr));
            return;
          }
          const base = fileName.replace(/\.[a-z0-9]+$/i, "") || "archive";
          downloadBlob(data as unknown as BlobPart, base.endsWith(".zip") ? base : `${base}.zip`, "application/zip");
        });
      } catch (e) {
        setBusy(null);
        setExtractError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
  }

  if (err) {
    return <ErrorCard title="Could not open archive" message={err} hint="Try the Hex viewer for raw byte inspection — the archive may use an unsupported codec." />;
  }
  if (!model) return <LoadingState label="Scanning archive structure…" />;

  const kindLabel =
    model.kind === "zip" ? "ZIP" :
    model.kind === "tar" ? "TAR" :
    model.kind === "gz" ? `GZIP → ${model.subKind ?? ""}`.trim() :
    model.kind === "iso" ? "ISO 9660" :
    model.kind === "rar" ? "RAR" : "7z";
  const isCodecOnly = model.kind === "rar" || model.kind === "7z";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Archive className="h-3 w-3" />{kindLabel}</Chip>
            {containerChips.map((c) => (
              <Chip key={c.label} tone={c.tone}>
                {c.label === "Android package" ? <Package className="h-3 w-3" /> : c.label === "Java archive" ? <Coffee className="h-3 w-3" /> : null}
                {c.label}
              </Chip>
            ))}
            {stats && !isCodecOnly ? (
              <>
                <Chip>{formatNum(stats.files)} files</Chip>
                {stats.folders ? <Chip>{formatNum(stats.folders)} folders</Chip> : null}
                <Chip>uncompressed {formatBytes(stats.total)}</Chip>
                {stats.total > 0 ? <Chip tone="teal">{Math.round((stats.packed / stats.total) * 100)}% of original</Chip> : null}
              </>
            ) : null}
            {stats?.enc ? <Chip tone="amber"><Lock className="h-3 w-3" />{stats.enc} encrypted</Chip> : null}
            {model.bad ? <Chip tone="amber">{model.bad} unreadable</Chip> : null}
          </>
        }
        center={
          !isCodecOnly ? (
            <div className="flex h-7 w-full max-w-xs items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter entries…"
                className="min-w-0 flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} className="mr-1 text-zinc-500 hover:text-zinc-200" title="Clear filter">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : undefined
        }
        right={
          !isCodecOnly ? (
            <div className="flex items-center gap-1.5">
              {extractable ? (
                <ToolButton
                  label="Select all"
                  onClick={selectAllFiltered}
                  title="Select every extractable entry for bulk download / re-pack"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                </ToolButton>
              ) : null}
              <Chip>{formatNum(filtered.length)} shown</Chip>
            </div>
          ) : undefined
        }
      />
      <ViewerBody className="p-3">
        {isCodecOnly ? (
          <UnsupportedCodecCard model={model} />
        ) : (
          <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="order-2 min-w-0 xl:order-1">
              {filtered.length === 0 ? (
                <EmptyHint>
                  {model.entries.length ? "No entries match the filter." : "This archive contains no entries."}
                </EmptyHint>
              ) : (
                <>
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          {extractable ? (
                            <th className="w-9 px-2 py-2">
                              <input
                                type="checkbox"
                                checked={allSel}
                                onChange={toggleAll}
                                aria-label="Select all extractable entries"
                                title="Select / deselect all extractable entries"
                                className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                                ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                              />
                            </th>
                          ) : null}
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Size</th>
                          <th className="hidden whitespace-nowrap px-3 py-2 text-right font-medium md:table-cell">Packed</th>
                          <th className="hidden whitespace-nowrap px-3 py-2 text-right font-medium md:table-cell">Ratio</th>
                          <th className="hidden whitespace-nowrap px-3 py-2 font-medium lg:table-cell">Method</th>
                          <th className="hidden whitespace-nowrap px-3 py-2 font-medium lg:table-cell">CRC-32</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, visible).map((e, idx) => {
                          const isSel = selected === e.path;
                          const ratio = e.size > 0 && e.packed !== e.size ? Math.round((e.packed / e.size) * 100) + "%" : null;
                          const draggable = !!e.read && !e.encrypted;
                          return (
                            <tr
                              key={e.path + ":" + e.size}
                              title={e.isDir ? e.path : draggable ? `${e.path}\n\nClick to preview · drag out to save directly${sel.has(e.path) && selEntries.length >= 2 ? `\nDragging takes all ${selEntries.length} ticked entries as one zip` : ""}` : e.path}
                              draggable={draggable}
                              onDragStart={draggable ? (ev) => handleRowDragStart(ev, e) : undefined}
                              onClick={() => {
                                if (e.isDir) {
                                  setQuery(e.path.endsWith("/") ? e.path : e.path + "/");
                                  setSelected(null);
                                } else {
                                  setSelected(e.path);
                                }
                              }}
                              className={cn(
                                "border-t border-zinc-800/60 transition-colors hover:bg-zinc-800/50",
                                draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
                                idx % 2 === 1 && !isSel && "bg-zinc-900/40",
                                isSel && "bg-emerald-900/20",
                                sel.has(e.path) && !isSel && "bg-emerald-950/30",
                                "group/tr",
                              )}
                            >
                              {extractable ? (
                                <td className="px-2 py-1.5">
                                  {e.read && !e.encrypted ? (
                                    <input
                                      type="checkbox"
                                      checked={sel.has(e.path)}
                                      onChange={() => toggleSel(e.path)}
                                      onClick={(ev) => ev.stopPropagation()}
                                      aria-label={"Select " + (baseOf(e.path) || e.path)}
                                      className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
                                    />
                                  ) : null}
                                </td>
                              ) : null}
                              <td className="max-w-0 w-full px-3 py-1.5">
                                <div className="flex min-w-0 items-center gap-2">
                                  {draggable ? (
                                    <GripVertical
                                      aria-hidden
                                      className="h-3 w-3 shrink-0 -ml-1 text-zinc-600 opacity-0 transition-opacity group-hover/tr:opacity-100"
                                    />
                                  ) : null}
                                  {e.isDir ? (
                                    <Folder className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />
                                  ) : (
                                    <FileIcon className={cn("h-3.5 w-3.5 shrink-0", e.encrypted ? "text-amber-500/80" : "text-zinc-500")} />
                                  )}
                                  <span className="truncate font-mono text-[11px]">
                                    <span className="text-zinc-600">{dirOf(e.path)}</span>
                                    <span className={cn(e.isDir ? "text-emerald-300" : "text-zinc-200")}>{baseOf(e.path) || e.path}</span>
                                  </span>
                                  {e.encrypted ? <Lock className="h-3 w-3 shrink-0 text-amber-400" /> : null}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-zinc-300">
                                {e.isDir ? "—" : formatBytes(e.size)}
                              </td>
                              <td className="hidden whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-zinc-400 md:table-cell">
                                {e.isDir || e.packed === e.size ? "—" : formatBytes(e.packed)}
                              </td>
                              <td className="hidden whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-zinc-400 md:table-cell">
                                {ratio ?? (e.isDir ? "—" : "100%")}
                              </td>
                              <td className="hidden whitespace-nowrap px-3 py-1.5 text-zinc-500 lg:table-cell">{e.method}</td>
                              <td className="hidden whitespace-nowrap px-3 py-1.5 font-mono text-[10px] text-zinc-500 lg:table-cell">
                                {e.crc != null ? e.crc.toString(16).toUpperCase().padStart(8, "0") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {selEntries.length > 0 || extractError ? (
                    <div className="sticky bottom-3 z-10 mt-3 space-y-2">
                      {extractError ? (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 p-2.5 text-[11px] leading-relaxed text-amber-300/90 backdrop-blur">
                          <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {extractError}
                        </div>
                      ) : null}
                      {selEntries.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-900/60 bg-zinc-800/95 px-3 py-2 shadow-xl shadow-black/50 backdrop-blur">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <SquareCheckBig className="h-3.5 w-3.5" />
                            )}
                            {busy?.kind === "download"
                              ? `Downloading ${busy.done}/${busy.total}…`
                              : busy?.kind === "zip"
                                ? "Packaging…"
                                : `${formatNum(selEntries.length)} selected`}
                          </span>
                          <span className="hidden text-[11px] text-zinc-500 sm:inline">{formatBytes(selBytes)} uncompressed</span>
                          <div className="ml-auto flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={downloadSelected}
                              disabled={!!busy}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Download individually
                            </button>
                            <button
                              type="button"
                              onClick={saveSelectionAsZip}
                              disabled={!!busy}
                              title="Re-pack the selection as a new ZIP (deflate, or stored when payloads are already compressed)"
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-800/70 bg-emerald-950/40 px-2.5 text-[11px] font-medium text-emerald-300 transition-colors hover:border-emerald-600 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <FileArchive className="h-3.5 w-3.5" />
                              Save as .zip
                            </button>
                            <button
                              type="button"
                              onClick={() => setSel(new Set())}
                              disabled={!!busy}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <X className="h-3.5 w-3.5" />
                              Clear
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {filtered.length > visible ? (
                    <button
                      type="button"
                      onClick={() => setVisible((v) => v + 500)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 py-2 text-xs text-zinc-400 transition-colors hover:border-emerald-800/60 hover:text-emerald-300"
                    >
                      <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                      Show 500 more — {formatNum(filtered.length - visible)} hidden
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <div className="order-1 min-w-0 xl:order-2">
              {selectedEntry ? (
                <EntryPanel entry={selectedEntry} onClose={() => setSelected(null)} onOpenFile={onOpenFile} />
              ) : (
                <ArchiveInfoCard model={model} fileName={fileName} />
              )}
            </div>
          </div>
        )}
        {model.warnings.length ? (
          <div className="mx-auto mt-4 max-w-4xl space-y-1">
            {model.warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300/90">
                <FileWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        ) : null}
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Archive className="h-3.5 w-3.5" />
        <span className="truncate">
          {detected.name} · {formatBytes(file.size)} · click a file to preview or open it{model.tailOnly ? " (directory-only mode)" : ""}
        </span>
      </div>
    </div>
  );
}
