/** Custom audio/video container & tag parsers (no external deps). */
import { DataReader, findAscii, u32le, u32be, u16le, u16be, readVint } from "@/lib/binary";

export interface MediaMeta {
  kind: "audio" | "video";
  container?: string;
  durationSec?: number;
  codec?: string;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  bitrateKbps?: number;
  tags?: Record<string, string>;
  picture?: { blob: Blob; url: string } | null;
  video?: { width: number; height: number; fps?: number };
  extra?: Record<string, string>;
}

/* --------------------------------- WAV ---------------------------------- */

export function parseWav(head: Uint8Array): MediaMeta | null {
  if (!findAscii(head, "WAVE", 0, 12)) return null;
  const r = new DataReader(head);
  r.seek(12);
  const meta: MediaMeta = { kind: "audio", container: "RIFF/WAVE", tags: {} };
  const extra: Record<string, string> = {};
  const textDec = new TextDecoder("latin1");
  while (r.has(8)) {
    const id = r.ascii(4);
    const size = r.u32();
    const start = r.offset;
    if (id === "fmt ") {
      const fmt = r.u16();
      const channels = r.u16();
      const sampleRate = r.u32();
      const byteRate = r.u32();
      r.skip(2);
      const bits = r.u16();
      meta.channels = channels;
      meta.sampleRate = sampleRate;
      meta.bitsPerSample = bits;
      meta.bitrateKbps = Math.round(byteRate * 8 / 1000);
      const fmtNames: Record<number, string> = {
        1: "PCM", 3: "IEEE float", 6: "A-law", 7: "µ-law", 0xfffe: "EXTENSIBLE",
        2: "ADPCM", 17: "IMA ADPCM", 32: "ANSI", 85: "MP3", 0x0500: "G.723 ADPCM",
      };
      meta.codec = fmtNames[fmt] ?? `fmt ${fmt}`;
      if (fmt === 0xfffe && r.has(2)) {
        const sub = r.u16();
        meta.codec = `WAVE_FORMAT_EXTENSIBLE (${["?", "PCM", "IEEE float"][sub] ?? sub})`;
      }
      r.seek(start + size + (size % 2));
    } else if (id === "LIST") {
      const type = r.ascii(4);
      if (type === "INFO") {
        const end = start + size;
        while (r.offset < end && r.has(4)) {
          const tagId = r.ascii(4);
          const len = r.u32();
          const val = textDec.decode(r.bytesOf(Math.min(len, 256))).replace(/\0+$/, "");
          const NAMES: Record<string, string> = {
            INAM: "Title", IART: "Artist", IPRD: "Album", ICRD: "Date", ICMT: "Comment",
            IGNR: "Genre", ITRK: "Track", ICOP: "Copyright", ISFT: "Software",
          };
          if (val) meta.tags![NAMES[tagId] ?? tagId] = val;
        }
      }
      r.seek(start + size + (size % 2));
    } else {
      r.seek(start + size + (size % 2));
    }
  }
  meta.extra = extra;
  return meta;
}

/* ---------------------------------- MP3 --------------------------------- */

function syncsafe(b: Uint8Array, o: number): number {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
}

function parseId3v2(head: Uint8Array): { meta: MediaMeta; end: number } | null {
  if (!(head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33)) return null;
  const ver = head[3];
  const size = syncsafe(head, 6);
  const r = new DataReader(head);
  r.seek(10);
  const meta: MediaMeta = { kind: "audio", container: "MPEG audio (ID3v2." + ver + ")", tags: {} };
  const end = 10 + size;
  while (r.offset + 10 < Math.min(end, head.length)) {
    const frameId = r.ascii(4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const fsize = ver === 4 ? syncsafe(head, r.offset) : u32be(head, r.offset);
    r.skip(4);
    const flags = r.u16();
    void flags;
    const fstart = r.offset;
    if (frameId === "APIC" || frameId === "PIC" || frameId === "GEOB") {
      try {
        r.skip(1); // encoding
        if (frameId === "PIC") r.skip(3);
        else {
          // mime cstring
          while (r.offset < Math.min(fstart + fsize, head.length) && r.u8() !== 0) { /* skip mime */ }
        }
        r.skip(1); // picture type
        // description (terminated by 0 in encoding)
        while (r.offset < Math.min(fstart + fsize, head.length) && r.u8() !== 0) { /* skip desc */ }
        const data = head.subarray(r.offset, Math.min(fstart + fsize, head.length));
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        const blob = new Blob([new Uint8Array(data)], { type: isPng ? "image/png" : "image/jpeg" });
        meta.picture = { blob, url: URL.createObjectURL(blob) };
      } catch { /* ignore */ }
    } else {
      const data = head.subarray(fstart, Math.min(fstart + fsize, head.length));
      let text = "";
      if (data[0] === 0) text = new TextDecoder("latin1").decode(data.subarray(1)).replace(/\0+$/, "");
      else if (data[0] === 1) {
        const b = data.subarray(1);
        const be = b[0] === 0xff || (b[0] === 0xfe && b[1] !== 0xff);
        text = new TextDecoder(be ? "utf-16be" : "utf-16le").decode(b.subarray(be ? 0 : 0)).replace(/^\uFEFF/, "").replace(/\0+$/, "");
      } else if (data[0] === 2) text = new TextDecoder("utf-16be").decode(data.subarray(1)).replace(/\0+$/, "");
      else if (data[0] === 3) text = new TextDecoder("utf-8").decode(data.subarray(1)).replace(/\0+$/, "");
      const NAMES: Record<string, string> = {
        TIT2: "Title", TPE1: "Artist", TPE2: "Album artist", TALB: "Album", TCON: "Genre",
        TYER: "Year", TDRC: "Date", TRCK: "Track", TPOS: "Disc", TCOM: "Composer", TPUB: "Publisher",
        TBPM: "BPM", TKEY: "Key", TLEN: "Length ms", COMM: "Comment", TXXX: "Extra", USLT: "Lyrics",
        TCOP: "Copyright", WOAR: "Artist URL", TPUB2: "Pub",
      };
      if (text && frameId !== "TXXX") meta.tags![NAMES[frameId] ?? frameId] = text;
      if (frameId === "COMM" || frameId === "USLT" || frameId === "TXXX") {
        const joined = text.replace(/^\w{3}\x00?/, "");
        if (joined) meta.tags![NAMES[frameId]] = joined;
      }
    }
    r.seek(fstart + fsize);
  }
  return { meta, end };
}

const MPEG_LAYERS = ["III", "II", "I"];
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MPEG1_RATES = [44100, 48000, 32000, 0];
const MPEG2_RATES = [22050, 24000, 16000, 0];
const MPEG25_RATES = [11025, 12000, 8000, 0];

export function parseMp3(head: Uint8Array, size: number): MediaMeta | null {
  const id3 = parseId3v2(head);
  let m = head;
  let audioStart = 0;
  if (id3) {
    m = head.subarray(id3.end);
    audioStart = id3.end;
    void audioStart;
  }
  // find first frame sync
  let i = 0;
  for (; i < m.length - 4; i++) {
    if (m[i] === 0xff && (m[i + 1] & 0xe0) === 0xe0 && m[i + 1] !== 0xff) break;
  }
  if (i >= m.length - 4) return id3?.meta ?? null;
  const b1 = m[i + 1];
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  const ver = versionBits === 3 ? 1 : versionBits === 2 ? 2 : versionBits === 0 ? 2.5 : 0;
  const layer = MPEG_LAYERS[layerBits === 0 ? 0 : 3 - layerBits] ?? "?";
  const bitrateIdx = (m[i + 2] >> 4) & 15;
  const srIdx = (m[i + 2] >> 2) & 3;
  const rates = ver === 1 ? MPEG1_RATES : ver === 2 ? MPEG2_RATES : MPEG25_RATES;
  const sampleRate = rates[srIdx];
  const bitrates = ver === 1 ? MPEG1_BITRATES : MPEG2_BITRATES;
  const kbps = bitrates[bitrateIdx] || 0;
  const channelMode = (m[i + 3] >> 6) & 3;
  const channels = channelMode === 3 ? 1 : 2;
  const meta: MediaMeta = id3?.meta ?? { kind: "audio", tags: {} };
  meta.container = `MPEG-${ver} Layer ${layer}`;
  meta.codec = `MP${layer}`;
  meta.sampleRate = sampleRate;
  meta.channels = channels;
  meta.bitrateKbps = kbps;
  if (kbps && size && layer === "III" && ver === 1) {
    meta.durationSec = Math.round((size * 8) / (kbps * 1000));
  }
  if (!meta.tags) meta.tags = {};
  return meta;
}

/* --------------------------------- FLAC --------------------------------- */

export function parseFlac(head: Uint8Array): MediaMeta | null {
  if (!findAscii(head, "fLaC", 0, 4)) return null;
  const r = new DataReader(head);
  r.seek(4);
  const meta: MediaMeta = { kind: "audio", container: "FLAC", tags: {} };
  let last = false;
  while (!last && r.has(4)) {
    const header = r.u8();
    last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = (r.u8() << 16) | (r.u8() << 8) | r.u8();
    const start = r.offset;
    if (type === 0 && r.has(34)) {
      meta.channels = ((r.u8() >> 1) & 0x7f) + 1;
      const bps = ((r.bytesOf(2)[1] >> 4) & 0xf) + 1;
      meta.bitsPerSample = bps;
      const sr = (r.u8() << 16) | (r.u8() << 8) | r.u8();
      meta.sampleRate = sr;
      meta.codec = "FLAC";
    } else if (type === 4 && r.has(8)) {
      // VORBIS_COMMENT
      const vlen = u32le(head, r.offset);
      r.skip(4 + vlen);
      const count = u32le(head, r.offset);
      r.skip(4);
      for (let i = 0; i < count && r.has(4); i++) {
        const clen = u32le(head, r.offset);
        r.skip(4);
        const s = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(r.offset, r.offset + clen));
        r.skip(clen);
        const eq = s.indexOf("=");
        if (eq > 0) {
          const k = s.slice(0, eq).toUpperCase();
          const key = { TITLE: "Title", ARTIST: "Artist", ALBUM: "Album", DATE: "Date", GENRE: "Genre", TRACKNUMBER: "Track", DISCNUMBER: "Disc", ALBUMARTIST: "Album artist", COMPOSER: "Composer", COMMENT: "Comment" }[k] ?? k;
          meta.tags![key] = s.slice(eq + 1);
        }
      }
    } else if (type === 6) {
      // PICTURE
      try {
        r.skip(4); // type
        const mlen = u32be(head, r.offset);
        r.skip(4 + mlen);
        const dlen = u32be(head, r.offset);
        r.skip(4);
        const data = head.subarray(r.offset, r.offset + dlen);
        const isPng = data[0] === 0x89;
        const blob = new Blob([new Uint8Array(data)], { type: isPng ? "image/png" : "image/jpeg" });
        meta.picture = { blob, url: URL.createObjectURL(blob) };
      } catch { /* ignore */ }
    }
    r.seek(start + len);
  }
  return meta;
}

/* ---------------------------------- Ogg --------------------------------- */

export function parseOgg(head: Uint8Array): MediaMeta | null {
  if (!findAscii(head, "OggS", 0, 4)) return null;
  const meta: MediaMeta = { kind: "audio", container: "Ogg", tags: {} };
  // find codec signature in first packets
  const vorbisIdx = findAscii(head, "\x01vorbis", 0, 4096);
  const opusIdx = findAscii(head, "OpusHead", 0, 4096);
  const flacIdx = findAscii(head, "\x7fFLAC", 0, 4096);
  const theoraIdx = findAscii(head, "\x80theora", 0, 4096);
  if (opusIdx >= 0) {
    meta.codec = "Opus";
    const r = new DataReader(head);
    r.seek(opusIdx + 9);
    meta.channels = r.u8();
    meta.sampleRate = 48000;
    const pre = head[opusIdx + 11] | (head[opusIdx + 12] << 8) | (head[opusIdx + 13] << 16) | (head[opusIdx + 14] << 24);
    void pre;
    meta.container = "Ogg/Opus";
  } else if (vorbisIdx >= 0) {
    meta.codec = "Vorbis";
    const r = new DataReader(head);
    r.seek(vorbisIdx + 5);
    const channels = r.u8();
    const sr = r.u32();
    const br = r.u32();
    meta.channels = channels;
    meta.sampleRate = sr;
    meta.bitrateKbps = Math.round(br / 1000) || undefined;
  } else if (flacIdx >= 0) {
    meta.codec = "Ogg FLAC";
  } else if (theoraIdx >= 0) {
    meta.kind = "video";
    meta.codec = "Theora";
  }
  // vorbis comments
  const commIdx = findAscii(head, "\x03vorbis", 0, 8192);
  const opusComm = findAscii(head, "OpusTags", 0, 8192);
  const cIdx = Math.max(commIdx, opusComm);
  if (cIdx >= 0) {
    const r = new DataReader(head);
    r.seek(cIdx + (commIdx >= 0 ? 7 + 4 : 8 + 4));
    const vlen = u32le(head, cIdx + (commIdx >= 0 ? 7 : 8));
    r.skip(vlen);
    if (r.has(4)) {
      const count = u32le(head, r.offset);
      r.skip(4);
      for (let i = 0; i < count && i < 64 && r.has(4); i++) {
        const clen = u32le(head, r.offset);
        r.skip(4);
        const s = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(r.offset, r.offset + clen));
        r.skip(clen);
        const eq = s.indexOf("=");
        if (eq > 0) {
          const k = s.slice(0, eq).toUpperCase();
          const key = { TITLE: "Title", ARTIST: "Artist", ALBUM: "Album", DATE: "Date", GENRE: "Genre", TRACKNUMBER: "Track" }[k] ?? k;
          meta.tags![key] = s.slice(eq + 1);
        }
      }
    }
  }
  return meta;
}

/* ---------------------------------- MP4 --------------------------------- */

function walkAtoms(head: Uint8Array, start: number, end: number, path: string[], visit: (type: string, off: number, size: number, path: string[]) => void) {
  let off = start;
  while (off + 8 <= end && off + 8 <= head.length) {
    let size = u32be(head, off);
    const type = String.fromCharCode(head[off + 4], head[off + 5], head[off + 6], head[off + 7]);
    let hdr = 8;
    if (size === 1) {
      // 64-bit size
      size = Number(new DataView(head.buffer, head.byteOffset + off + 8, 8).getBigUint64(0)) || end - off;
      hdr = 16;
    } else if (size === 0) {
      size = end - off;
    }
    if (size < 8 || off + size > head.length + 1024 * 1024) break;
    visit(type, off, size, path);
    if (["moov", "trak", "mdia", "minf", "stbl", "udta", "ilst", "meta", "stsd", "dinf", "edts", "mvex", "moof", "traf"].includes(type)) {
      const inner = type === "meta" ? off + hdr + 4 : off + hdr;
      if (inner < end) walkAtoms(head, inner, Math.min(off + size, head.length), [...path, type], visit);
    }
    off += size;
  }
}

const ILST_KEYS: Record<string, string> = {
  "\u00a9nam": "Title", "\u00a9ART": "Artist", "\u00a9alb": "Album", "\u00a9day": "Date",
  "\u00a9gen": "Genre", "\u00a9wrt": "Composer", trkn: "Track", disk: "Disc", covr: "__cover",
  "\u00a9too": "Encoder", "\u00a9cmt": "Comment", aART: "Album artist", desc: "Description",
};

export function parseMp4(head: Uint8Array): MediaMeta | null {
  const ftypIdx = findAscii(head, "ftyp", 0, 12);
  if (ftypIdx < 0) return null;
  const brand = String.fromCharCode(head[ftypIdx + 4], head[ftypIdx + 5], head[ftypIdx + 6], head[ftypIdx + 7]);
  const meta: MediaMeta = { kind: brand === "qt  " ? "video" : "audio", container: `MP4 (ftyp ${brand})`, tags: {} };
  walkAtoms(head, 0, Math.min(head.length, 256 * 1024), [], (type, off, size, path) => {
    if (type === "mvhd" && path.join("/") === "moov") {
      const r = new DataReader(head);
      r.seek(off + 8);
      const ver = r.u8();
      r.skip(3);
      let timescale: number, duration: number;
      if (ver === 1) { r.skip(16); timescale = r.u32(); duration = Number(r.u64()); }
      else { r.skip(8); timescale = r.u32(); duration = r.u32(); }
      if (timescale) {
        meta.durationSec = duration / timescale;
        meta.bitrateKbps = undefined;
      }
    } else if (type === "tkhd" && path.join("/") === "moov/trak") {
      const r = new DataReader(head);
      r.seek(off + 8);
      const ver = r.u8();
      r.skip(ver === 1 ? 96 - 8 - 1 : 84 - 8 - 1);
      const w = u16be(head, r.offset + 0) / 256;
      const h = u16be(head, r.offset + 4) / 256;
      if (w > 0 && h > 0) {
        meta.kind = "video";
        meta.video = { width: Math.round(w), height: Math.round(h) };
      }
    } else if (type === "stsd" && path.join("/").endsWith("minf/stbl")) {
      // codec sample description
      const r = new DataReader(head);
      r.seek(off + 8 + 4 + 4);
      if (r.has(8)) {
        const codec = r.ascii(4);
        if (/^[a-zA-Z0-9]{3,4}$/.test(codec) && codec !== "mp4a") meta.codec = meta.codec ?? codec;
        if (codec === "mp4a") {
          meta.codec = "AAC (mp4a)";
          const r2 = new DataReader(head);
          r2.seek(off + 8 + 8 + 6 + 2 + 2 + 2 + 2 + 4);
          const sr = u16be(head, r2.offset) | (u16be(head, r2.offset + 2) >> 16) | (u16be(head, r2.offset + 2) << 16);
          void sr;
        }
        if (codec === "avc1" || codec === "hvc1" || codec === "hev1") {
          meta.codec = codec === "avc1" ? "H.264 (avc1)" : "HEVC";
          meta.kind = "video";
        }
      }
    } else if (type === "esds") {
      if (!meta.codec) meta.codec = "MPEG-4 audio";
    } else if (path.join("/").endsWith("ilst") && ILST_KEYS[type]) {
      const key = ILST_KEYS[type];
      const dataAtom = findAscii(head, "data", off + 8, off + size);
      if (dataAtom >= 0) {
        const dtype = u32be(head, dataAtom + 4) & 0xffffff;
        const dstart = dataAtom + 16;
        const dend = Math.min(off + size, dstart + 512);
        if (key === "__cover") {
          const data = head.subarray(dstart, Math.min(off + size, dstart + 2 * 1024 * 1024));
          if (data.length > 32) {
            const isPng = data[0] === 0x89 && data[1] === 0x50;
            const blob = new Blob([new Uint8Array(data)], { type: isPng ? "image/png" : "image/jpeg" });
            meta.picture = { blob, url: URL.createObjectURL(blob) };
          }
        } else {
          let val: string;
          if (dtype === 0 || dtype === 1) val = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(dstart, dend)).replace(/\0+$/, "");
          else {
            const nums: number[] = [];
            for (let i = dstart; i < Math.min(dstart + 8, off + size); i++) nums.push(head[i]);
            val = nums.join(" / ").trim();
          }
          if (val) meta.tags![key] = val;
        }
      }
    } else if (type === "hdlr" && path.join("/").endsWith("mdia")) {
      const h = String.fromCharCode(head[off + 16], head[off + 17], head[off + 18], head[off + 19]);
      if (h === "vide") meta.kind = "video";
    }
  });
  if (meta.durationSec && meta.kind === "audio" && !meta.codec) meta.codec = "AAC";
  return meta;
}

/* --------------------------------- Matroska ------------------------------ */

export function parseMatroska(head: Uint8Array): MediaMeta | null {
  const ebml = readVint(head, 0);
  if (!ebml.length || (head[0] !== 0x1a && head[1] !== 0x45)) return null;
  const meta: MediaMeta = { kind: "video", container: "Matroska/WebM (EBML)", tags: {} };
  // very light: find Segment → Info → TimecodeScale + Duration, Tracks
  const segIdx = findAscii(head, "\x85\x80\x84\x77\x6f", 0, 64);
  void segIdx;
  // Duration is a float inside Info; do a shallow scan for common doc types instead
  const doctype = findAscii(head, "webm", 0, 128);
  if (doctype >= 0) meta.container = "WebM";
  // scan segment-level children heuristically: look for T ID 0x1549A966 "Info"
  function scanId(id: string, maxFrom = 0): number {
    return findAscii(head, id, maxFrom, Math.min(head.length, maxFrom + 4096));
  }
  const infoIdx = scanId("\x15\x49\xa9\x66");
  if (infoIdx >= 0) {
    const size = readVint(head, infoIdx + 4);
    const end = infoIdx + 4 + size.length + size.value;
    let off = infoIdx + 4 + size.length;
    let timeScale = 1e6;
    while (off < end - 4 && off < head.length - 4) {
      const el = readVint(head, off);
      if (!el.length) break;
      const elId = head[off + 1] === 0x44 && el.length === 1 ? 0x44 : 0;
      const elSize = readVint(head, off + el.length);
      if (!elSize.length) break;
      const dstart = off + el.length + elSize.length;
      if (head[off + el.length - 1] === 0x2f) { // TimecodeScale? ID 0x4D? use direct
      }
      if (head[off] === 0x2A && dstart + 8 <= head.length) {
        const dv = new DataView(head.buffer, head.byteOffset + dstart, 8);
        const dur = dv.getFloat64(0);
        meta.durationSec = (dur * timeScale) / 1e9;
      }
      if (elId === 0x44 || (head[off] === 0x44 && head[off + 1] === 0x41)) {
        // 0x447A? not typical
      }
      off = dstart + elSize.value;
    }
    void timeScale;
  }
  const tracksIdx = scanId("\x1e\x54\xba\xab");
  if (tracksIdx >= 0) {
    const codecPos = findAscii(head, "V_VP", tracksIdx, tracksIdx + 2048);
    const codecPos2 = findAscii(head, "A_OPUS", tracksIdx, tracksIdx + 2048);
    const codecPos3 = findAscii(head, "V_MPEG4/ISO/AVC", tracksIdx, tracksIdx + 2048);
    if (codecPos >= 0) meta.codec = "VP8/VP9";
    else if (codecPos2 >= 0) meta.codec = "Opus";
    else if (codecPos3 >= 0) meta.codec = "H.264 (Matroska)";
    const codecVorbis = findAscii(head, "A_VORBIS", tracksIdx, tracksIdx + 2048);
    if (codecVorbis >= 0) { meta.codec = "Vorbis"; meta.kind = "audio"; }
    if (codecPos2 >= 0 || codecVorbis >= 0) meta.kind = "audio";
  }
  return meta;
}

/* --------------------------------- AVI ---------------------------------- */

export function parseAvi(head: Uint8Array): MediaMeta | null {
  if (!findAscii(head, "AVI ", 0, 16)) return null;
  const meta: MediaMeta = { kind: "video", container: "RIFF/AVI", tags: {} };
  const moviIdx = findAscii(head, "movi", 0, 4096);
  const avihIdx = findAscii(head, "avih", 0, 4096);
  if (avihIdx >= 0) {
    const r = new DataReader(head);
    r.seek(avihIdx + 8);
    const microSec = r.u32() || 1;
    meta.durationSec = Math.round((r.u32() * (microSec / 1e6)));
    r.skip(8);
    const w = r.u32(), h = r.u32();
    meta.video = { width: w, height: h, fps: Math.round(1e6 / microSec) };
  }
  const strhIdx = findAscii(head, "strh", 0, 8192);
  if (strhIdx >= 0) {
    const fcc = String.fromCharCode(head[strhIdx + 8], head[strhIdx + 9], head[strhIdx + 10], head[strhIdx + 11]);
    if (fcc === "vids") {
      const codecFcc = String.fromCharCode(head[strhIdx + 12], head[strhIdx + 13], head[strhIdx + 14], head[strhIdx + 15]);
      const codecNames: Record<string, string> = { "XVID": "Xvid", "DIVX": "DivX", "DX50": "DivX 5", "MJPG": "Motion JPEG", "FMP4": "FFmpeg MPEG-4", "H264": "H.264", "WMV3": "WMV9", "YV12": "Raw YUV" };
      meta.codec = codecNames[codecFcc] ?? codecFcc;
    }
    if (fcc === "auds") {
      const strfIdx = findAscii(head, "strf", strhIdx, strhIdx + 128);
      if (strfIdx >= 0) {
        const r = new DataReader(head);
        r.seek(strfIdx + 8);
        const fmt = r.u16();
        meta.channels = r.u16();
        meta.sampleRate = r.u32();
        meta.bitrateKbps = Math.round(r.u32() * 8 / 1000);
        meta.codec = fmt === 85 ? "MP3" : fmt === 1 ? "PCM" : fmt === 0xFFFE ? "EXTENSIBLE" : `fmt ${fmt}`;
      }
    }
  }
  void moviIdx;
  return meta;
}

/* ------------------------------- dispatcher ------------------------------ */

export function parseMediaMeta(head: Uint8Array, fileName: string, size: number): MediaMeta | null {
  try {
    if (head[0] === 0x52 && head[1] === 0x49) return parseWav(head) ?? parseAvi(head);
    if (findAscii(head, "fLaC", 0, 4) >= 0) return parseFlac(head);
    if (findAscii(head, "OggS", 0, 4) >= 0) return parseOgg(head);
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return parseMp3(head, size);
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return parseMp3(head, size);
    if (findAscii(head, "ftyp", 0, 12) >= 0) return parseMp4(head);
    if (head[0] === 0x1a && head[1] === 0x45) return parseMatroska(head);
    if (findAscii(head, "AIFF", 0, 16) >= 0 || findAscii(head, "AIFC", 0, 16) >= 0) {
      const meta: MediaMeta = { kind: "audio", container: "AIFF", codec: "PCM" };
      const commIdx = findAscii(head, "COMM", 0, 256);
      if (commIdx >= 0) {
        meta.channels = u16be(head, commIdx + 8);
        meta.sampleRate = Math.round(new DataView(head.buffer, head.byteOffset + commIdx + 18, 10).getFloat64(2));
        meta.bitsPerSample = u16be(head, commIdx + 14);
      }
      return meta;
    }
    if (findAscii(head, ".snd", 0, 4) >= 0) {
      const meta: MediaMeta = { kind: "audio", container: "NeXT/Sun AU", codec: "µ-law/PCM" };
      return meta;
    }
    if (head[0] === 0x30 && head[1] === 0x26 && head[2] === 0xb2) {
      return { kind: "video", container: "ASF", codec: "WMV/WMA" };
    }
    void fileName;
  } catch {
    return null;
  }
  return null;
}

/* --------------------------- waveform / spectrogram ---------------------- */

export function computeWaveform(channel: Float32Array, buckets: number): { mins: Float32Array; maxs: Float32Array } {
  const mins = new Float32Array(buckets);
  const maxs = new Float32Array(buckets);
  const step = channel.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * step);
    const end = Math.min(channel.length, Math.floor((b + 1) * step));
    let min = 1, max = -1;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    mins[b] = min;
    maxs[b] = max;
  }
  return { mins, maxs };
}

/** in-place iterative radix-2 FFT on re/im arrays */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Spectrogram columns (log-scaled magnitude, 0..1) */
export function computeSpectrogram(channel: Float32Array, cols: number, fftSize = 512): Float32Array {
  const out = new Float32Array(cols * (fftSize / 2));
  const step = Math.max(1, Math.floor(channel.length / cols));
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  for (let c = 0; c < cols; c++) {
    const start = Math.min(channel.length - fftSize, c * step);
    if (start < 0) break;
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = channel[start + i] * hann[i];
    fft(re, im);
    for (let b = 0; b < fftSize / 2; b++) {
      const mag = Math.hypot(re[b], im[b]) / fftSize;
      out[c * (fftSize / 2) + b] = Math.min(1, Math.pow(mag * 24, 0.5));
    }
  }
  return out;
}
