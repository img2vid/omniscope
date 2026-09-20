"use client";

import * as React from "react";
import * as dicomParserMod from "dicom-parser";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, ErrorCard, LoadingState,
  Segmented, Chip, InfoGrid, Field, SectionCard, EmptyHint, Copyable,
} from "./viewer-ui";
import { formatBytes, isLikelyValidUtf8, latin1, toHex, clamp } from "@/lib/utils";
import {
  Scan, Tag as TagIcon, Contrast, RotateCcw, Layers, Stethoscope, AlertTriangle, FileDigit,
} from "lucide-react";

/* The published module is a webpack UMD bundle whose default export shape has
   varied across releases — pick whichever object actually carries parseDicom. */
const dicomParser: typeof dicomParserMod =
  typeof (dicomParserMod as Record<string, unknown>).parseDicom === "function"
    ? dicomParserMod
    : (((dicomParserMod as Record<string, unknown>).default as unknown as typeof dicomParserMod) ?? dicomParserMod);

/* ============================== tag dictionary ============================== */

const TAG_NAMES: Record<string, string> = {
  x00020000: "File Meta Group Length",
  x00020001: "File Meta Version",
  x00020002: "Media Storage SOP Class UID",
  x00020003: "Media Storage SOP Instance UID",
  x00020010: "Transfer Syntax UID",
  x00020012: "Implementation Class UID",
  x00020013: "Implementation Version Name",
  x00080005: "Specific Character Set",
  x00080008: "Image Type",
  x00080012: "Instance Creation Date",
  x00080013: "Instance Creation Time",
  x00080016: "SOP Class UID",
  x00080018: "SOP Instance UID",
  x00080020: "Study Date",
  x00080021: "Series Date",
  x00080022: "Acquisition Date",
  x00080023: "Content Date",
  x00080030: "Study Time",
  x00080031: "Series Time",
  x00080032: "Acquisition Time",
  x00080033: "Content Time",
  x00080050: "Accession Number",
  x00080060: "Modality",
  x00080061: "Modalities in Study",
  x00080064: "Conversion Type",
  x00080070: "Manufacturer",
  x00080080: "Institution Name",
  x00080090: "Referring Physician",
  x00081030: "Study Description",
  x0008103e: "Series Description",
  x00081090: "Manufacturer Model Name",
  x00100010: "Patient Name",
  x00100020: "Patient ID",
  x00100030: "Patient Birth Date",
  x00100040: "Patient Sex",
  x00101010: "Patient Age",
  x00101040: "Patient Address",
  x00180015: "Body Part Examined",
  x00180050: "Slice Thickness",
  x00180088: "Spacing Between Slices",
  x0020000d: "Study Instance UID",
  x0020000e: "Series Instance UID",
  x00200010: "Study ID",
  x00200011: "Series Number",
  x00200012: "Acquisition Number",
  x00200013: "Instance Number",
  x00200032: "Image Position Patient",
  x00200037: "Image Orientation Patient",
  x00201041: "Slice Location",
  x00280002: "Samples per Pixel",
  x00280004: "Photometric Interpretation",
  x00280006: "Planar Configuration",
  x00280008: "Number of Frames",
  x00280010: "Rows",
  x00280011: "Columns",
  x00280030: "Pixel Spacing",
  x00280100: "Bits Allocated",
  x00280101: "Bits Stored",
  x00280102: "High Bit",
  x00280103: "Pixel Representation",
  x00281050: "Window Center",
  x00281051: "Window Width",
  x00281052: "Rescale Intercept",
  x00281053: "Rescale Slope",
  x00281054: "Rescale Type",
  x00281101: "Red Palette LUT Descriptor",
  x00281102: "Green Palette LUT Descriptor",
  x00281103: "Blue Palette LUT Descriptor",
  x00281201: "Red Palette LUT Data",
  x00281202: "Green Palette LUT Data",
  x00281203: "Blue Palette LUT Data",
  x7fe00010: "Pixel Data",
};

const TS_NAMES: { prefix: string; name: string }[] = [
  { prefix: "1.2.840.10008.1.2.1.99", name: "Deflated Explicit VR LE" },
  { prefix: "1.2.840.10008.1.2.2", name: "Explicit VR Big Endian" },
  { prefix: "1.2.840.10008.1.2.4.80", name: "JPEG 2000 Lossless" },
  { prefix: "1.2.840.10008.1.2.4.81", name: "JPEG 2000" },
  { prefix: "1.2.840.10008.1.2.4.90", name: "JPEG 2000 Multicomponent" },
  { prefix: "1.2.840.10008.1.2.4.70", name: "JPEG-LS" },
  { prefix: "1.2.840.10008.1.2.4.57", name: "JPEG Lossless" },
  { prefix: "1.2.840.10008.1.2.4.51", name: "JPEG Extended" },
  { prefix: "1.2.840.10008.1.2.4.50", name: "JPEG Baseline" },
  { prefix: "1.2.840.10008.1.2.5", name: "RLE Lossless" },
  { prefix: "1.2.840.10008.1.2.4", name: "JPEG (encapsulated)" },
  { prefix: "1.2.840.10008.1.2.1", name: "Explicit VR Little Endian" },
  { prefix: "1.2.840.10008.1.2", name: "Implicit VR Little Endian" },
];

function tsName(uid: string): string {
  for (const t of TS_NAMES) if (uid.startsWith(t.prefix)) return t.name;
  return uid || "unknown";
}

const UNCOMPRESSED_TS = ["1.2.840.10008.1.2", "1.2.840.10008.1.2.1", "1.2.840.10008.1.2.2"];

/* ============================== image model ============================== */

interface DicomImage {
  kind: "gray" | "rgb";
  rows: number;
  cols: number;
  frames: number;
  photometric: string;
  bitsAllocated: number;
  bitsStored: number;
  signed: boolean;
  littleEndian: boolean;
  monochromeInvert: boolean; // MONOCHROME1
  rescaleSlope: number;
  rescaleIntercept: number;
  gray: Float32Array | null;       // frames × rows × cols, rescaled values
  rgb: Uint8Array | null;          // frames × rows × cols × 3, ready-to-show
  dataMin: number | null;
  dataMax: number | null;
  windowCenter: number | null;
  windowWidth: number | null;
}

type ImageResult =
  | { ok: true; image: DicomImage }
  | { ok: false; reason: "compressed" | "error"; message: string };

function firstFloat(dataSet: dicomParserMod.DataSet, tag: string): number | null {
  try {
    const raw = dataSet.string(tag);
    if (!raw) return null;
    const first = raw.split("\\")[0] ?? "";
    const v = parseFloat(first);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function extractImage(dataSet: dicomParserMod.DataSet, tsUid: string): ImageResult {
  try {
    const el = dataSet.elements["x7fe00010"];
    if (!el) return { ok: false, reason: "error", message: "No Pixel Data element (7FE0,0010) in this dataset." };
    if (el.encapsulatedPixelData) {
      return { ok: false, reason: "compressed", message: `Compressed pixel data (${tsName(tsUid)}) — pixel decoding unavailable, tags shown below.` };
    }
    const uncompressedOk = tsUid === "" || UNCOMPRESSED_TS.some((t) => tsUid.startsWith(t));
    if (!uncompressedOk) {
      return { ok: false, reason: "compressed", message: `Transfer syntax ${tsName(tsUid)} carries compressed pixel data — tags only.` };
    }

    const rows = dataSet.uint16("x00280010") ?? 0;
    const cols = dataSet.uint16("x00280011") ?? 0;
    if (!rows || !cols) return { ok: false, reason: "error", message: "Missing Rows/Columns (0028,0010/0011)." };
    const samples = dataSet.uint16("x00280002") ?? 1;
    const photometric = (dataSet.string("x00280004") ?? "").toUpperCase() || "MONOCHROME2";
    const bitsAllocated = dataSet.uint16("x00280100") ?? 8;
    const bitsStored = dataSet.uint16("x00280101") ?? bitsAllocated;
    const signed = (dataSet.uint16("x00280103") ?? 0) === 1;
    const planar = (dataSet.uint16("x00280006") ?? 0) === 1;
    const littleEndian = !tsUid.startsWith("1.2.840.10008.1.2.2");
    const slope = firstFloat(dataSet, "x00281053") ?? 1;
    const intercept = firstFloat(dataSet, "x00281052") ?? 0;
    const framesDeclared = parseInt(dataSet.string("x00280008") ?? "1", 10) || 1;

    if (rows * cols > 4096 * 4096) {
      return { ok: false, reason: "error", message: `Image too large to render (${rows}×${cols}) — tags only.` };
    }

    const bytes = dataSet.byteArray;
    const pixelBytes = bytes.subarray(el.dataOffset, el.dataOffset + el.length);
    const bpp = Math.max(1, bitsAllocated / 8);

    if (samples === 1) {
      const frameSize = rows * cols * bpp;
      if (pixelBytes.length < frameSize) {
        return { ok: false, reason: "error", message: `Pixel data truncated (${pixelBytes.length} bytes, need ${frameSize}).` };
      }
      const frames = Math.max(1, Math.min(framesDeclared, Math.floor(pixelBytes.length / frameSize), 512));
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const gray = new Float32Array(frames * rows * cols);
      const mask = bitsStored >= 16 ? 0xffff : (1 << bitsStored) - 1;
      const signShift = 32 - Math.min(16, Math.max(1, bitsStored));
      let vMin = Infinity;
      let vMax = -Infinity;
      for (let f = 0; f < frames; f++) {
        const base = el.dataOffset + f * frameSize;
        const outBase = f * rows * cols;
        for (let i = 0; i < rows * cols; i++) {
          let raw: number;
          if (bitsAllocated === 8) {
            raw = bytes[base + i];
          } else {
            raw = dv.getUint16(base + i * 2, littleEndian) & mask;
            if (signed) raw = (raw << signShift) >> signShift;
          }
          const v = raw * slope + intercept;
          gray[outBase + i] = v;
          if (v < vMin) vMin = v;
          if (v > vMax) vMax = v;
        }
      }
      return {
        ok: true,
        image: {
          kind: "gray", rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian,
          monochromeInvert: photometric === "MONOCHROME1",
          rescaleSlope: slope, rescaleIntercept: intercept,
          gray, rgb: null,
          dataMin: Number.isFinite(vMin) ? vMin : null,
          dataMax: Number.isFinite(vMax) ? vMax : null,
          windowCenter: firstFloat(dataSet, "x00281050"),
          windowWidth: firstFloat(dataSet, "x00281051"),
        },
      };
    }

    if (samples === 3) {
      if (bitsAllocated !== 8) {
        return { ok: false, reason: "error", message: `Unsupported ${bitsAllocated}-bit color image (only 8-bit RGB is decoded).` };
      }
      if (photometric.startsWith("YBR_FULL_422")) {
        const frameSize = rows * cols * 2;
        if (pixelBytes.length < frameSize) {
          return { ok: false, reason: "error", message: "YBR_FULL_422 pixel data truncated." };
        }
        const frames = Math.max(1, Math.min(framesDeclared, Math.floor(pixelBytes.length / frameSize), 512));
        const rgb = new Uint8Array(frames * rows * cols * 3);
        for (let f = 0; f < frames; f++) {
          const src = f * frameSize;
          const dst = f * rows * cols * 3;
          for (let p = 0; p < rows * cols; p += 2) {
            const y1 = pixelBytes[src + (p / 2) * 4];
            const y2 = pixelBytes[src + (p / 2) * 4 + 1];
            const cb = pixelBytes[src + (p / 2) * 4 + 2];
            const cr = pixelBytes[src + (p / 2) * 4 + 3];
            ybrToRgb(y1, cb, cr, rgb, dst + p * 3);
            ybrToRgb(y2, cb, cr, rgb, dst + (p + 1) * 3);
          }
        }
        return okRgb(rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian, rgb, slope, intercept,
          firstFloat(dataSet, "x00281050"), firstFloat(dataSet, "x00281051"));
      }
      if (photometric.startsWith("YBR")) {
        const frameSize = rows * cols * 3;
        if (pixelBytes.length < frameSize) {
          return { ok: false, reason: "error", message: "YBR pixel data truncated." };
        }
        const frames = Math.max(1, Math.min(framesDeclared, Math.floor(pixelBytes.length / frameSize), 512));
        const rgb = new Uint8Array(frames * rows * cols * 3);
        for (let f = 0; f < frames; f++) {
          const src = f * frameSize;
          const dst = f * frameSize;
          for (let p = 0; p < rows * cols; p++) {
            const y = pixelBytes[src + p * 3];
            const cb = pixelBytes[src + p * 3 + 1];
            const cr = pixelBytes[src + p * 3 + 2];
            ybrToRgb(y, cb, cr, rgb, dst + p * 3);
          }
        }
        return okRgb(rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian, rgb, slope, intercept,
          firstFloat(dataSet, "x00281050"), firstFloat(dataSet, "x00281051"));
      }
      if (photometric.startsWith("PALETTE")) {
        const lut = readPaletteLut(dataSet);
        if (!lut) {
          return { ok: false, reason: "error", message: "Palette-color image with no (or segmented) palette LUT — tags only." };
        }
        const frameSize = rows * cols;
        if (pixelBytes.length < frameSize) {
          return { ok: false, reason: "error", message: "Palette pixel data truncated." };
        }
        const frames = Math.max(1, Math.min(framesDeclared, Math.floor(pixelBytes.length / frameSize), 512));
        const rgb = new Uint8Array(frames * rows * cols * 3);
        for (let f = 0; f < frames; f++) {
          const src = f * frameSize;
          const dst = f * frameSize * 3;
          for (let p = 0; p < frameSize; p++) {
            const v = pixelBytes[src + p];
            rgb[dst + p * 3] = lut[v * 3];
            rgb[dst + p * 3 + 1] = lut[v * 3 + 1];
            rgb[dst + p * 3 + 2] = lut[v * 3 + 2];
          }
        }
        return okRgb(rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian, rgb, slope, intercept,
          firstFloat(dataSet, "x00281050"), firstFloat(dataSet, "x00281051"));
      }
      // plain RGB (or UNKNOWN) — 8-bit
      const frameSize = rows * cols * 3;
      if (pixelBytes.length < frameSize) {
        return { ok: false, reason: "error", message: "RGB pixel data truncated." };
      }
      const frames = Math.max(1, Math.min(framesDeclared, Math.floor(pixelBytes.length / frameSize), 512));
      let rgb = new Uint8Array(pixelBytes.subarray(0, frames * frameSize));
      if (planar) {
        // R…G…B planes → pixel interleaved
        const fixed = new Uint8Array(rgb.length);
        const np = rows * cols;
        for (let f = 0; f < frames; f++) {
          const base = f * frameSize;
          for (let p = 0; p < np; p++) {
            fixed[base + p * 3] = rgb[base + p];
            fixed[base + p * 3 + 1] = rgb[base + np + p];
            fixed[base + p * 3 + 2] = rgb[base + np * 2 + p];
          }
        }
        rgb = fixed;
      }
      return okRgb(rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian, rgb, slope, intercept,
        firstFloat(dataSet, "x00281050"), firstFloat(dataSet, "x00281051"));
    }

    return { ok: false, reason: "error", message: `Unsupported Samples per Pixel = ${samples}.` };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Pixel extraction failed" };
  }
}

function okRgb(
  rows: number, cols: number, frames: number, photometric: string,
  bitsAllocated: number, bitsStored: number, signed: boolean, littleEndian: boolean,
  rgb: Uint8Array, slope: number, intercept: number, wc: number | null, ww: number | null,
): ImageResult {
  return {
    ok: true,
    image: {
      kind: "rgb", rows, cols, frames, photometric, bitsAllocated, bitsStored, signed, littleEndian,
      monochromeInvert: false, rescaleSlope: slope, rescaleIntercept: intercept,
      gray: null, rgb, dataMin: null, dataMax: null, windowCenter: wc, windowWidth: ww,
    },
  };
}

function ybrToRgb(y: number, cb: number, cr: number, out: Uint8Array, o: number): void {
  const r = y + 1.402 * (cr - 128);
  const g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
  const b = y + 1.772 * (cb - 128);
  out[o] = clamp(Math.round(r), 0, 255);
  out[o + 1] = clamp(Math.round(g), 0, 255);
  out[o + 2] = clamp(Math.round(b), 0, 255);
}

/** Build a 256-entry RGB palette from (0028,1201..1203) LUT data. */
function readPaletteLut(dataSet: dicomParserMod.DataSet): Uint8Array | null {
  try {
    const descRaw = dataSet.string("x00281101");
    if (!descRaw) return null;
    const parts = descRaw.split("\\");
    const entries = parseInt(parts[0] ?? "256", 10) || 256;
    const first = parseInt(parts[1] ?? "0", 10) || 0;
    const bits = parseInt(parts[2] ?? "8", 10) || 8;
    const elR = dataSet.elements["x00281201"];
    const elG = dataSet.elements["x00281202"];
    const elB = dataSet.elements["x00281203"];
    if (!elR || !elG || !elB) return null;
    const dv = new DataView(dataSet.byteArray.buffer, dataSet.byteArray.byteOffset, dataSet.byteArray.byteLength);
    const lut = new Uint8Array(256 * 3);
    const wide = bits > 8;
    const n = Math.min(entries, 4096);
    for (let i = 0; i < 256; i++) {
      const idx = i - first;
      if (idx < 0 || idx >= n) { lut[i * 3] = lut[i * 3 + 1] = lut[i * 3 + 2] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        const el = c === 0 ? elR : c === 1 ? elG : elB;
        let v: number;
        if (wide) {
          if (el.dataOffset + idx * 2 + 2 > dataSet.byteArray.length) v = 0;
          else v = dv.getUint16(el.dataOffset + idx * 2, true) >> (bits - 8);
        } else {
          v = dataSet.byteArray[el.dataOffset + idx] ?? 0;
        }
        lut[i * 3 + c] = clamp(v, 0, 255);
      }
    }
    return lut;
  } catch {
    return null;
  }
}

/* ============================ tag value decoding ============================ */

function pnString(dataSet: dicomParserMod.DataSet, tag: string): string | undefined {
  try {
    const el = dataSet.elements[tag];
    if (!el || el.items || el.length === 0) return undefined;
    const bytes = dataSet.byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
    const dec = isLikelyValidUtf8(bytes) ? new TextDecoder("utf-8").decode(bytes) : latin1(bytes);
    return dec.replace(/[\r\n]+/g, " ").replace(/\s+=\s*/g, " = ").trim();
  } catch {
    return undefined;
  }
}

function tagValue(dataSet: dicomParserMod.DataSet, el: dicomParserMod.Element): string {
  const tag = el.tag;
  const len = el.length;
  if (el.items) return `Sequence — ${el.items.length} item${el.items.length === 1 ? "" : "s"}`;
  if (tag === "x7fe00010") return `<pixel data — ${formatBytes(len)}>`;
  if (len === 0) return "";
  const vr = (el.vr ?? "").toUpperCase();
  try {
    const nums = (width: number, read: (i: number) => number | undefined): string => {
      const vals: number[] = [];
      const count = Math.min(Math.floor(len / width), 32);
      for (let i = 0; i < count; i++) {
        const v = read(i);
        if (v === undefined) break;
        vals.push(v);
      }
      return vals.join(" \\ ");
    };
    switch (vr) {
      case "US": return nums(2, (i) => dataSet.uint16(tag, i));
      case "SS": return nums(2, (i) => dataSet.int16(tag, i));
      case "UL": return nums(4, (i) => dataSet.uint32(tag, i));
      case "SL": return nums(4, (i) => dataSet.int32(tag, i));
      case "FL": return nums(4, (i) => dataSet.float(tag, i));
      case "FD": return nums(8, (i) => dataSet.double(tag, i));
      case "AT": return dataSet.attributeTag(tag) ?? "";
      case "PN": return pnString(dataSet, tag) ?? "";
      case "OB":
      case "OW":
      case "OF":
      case "OD":
      case "UN":
      case "OV":
        if (len > 128) {
          const bytes = dataSet.byteArray.subarray(el.dataOffset, el.dataOffset + 12);
          return `<${formatBytes(len)}> ${toHex(bytes)}…`;
        }
        return toHex(dataSet.byteArray.subarray(el.dataOffset, el.dataOffset + len));
      default: {
        const s = vr === "ST" || vr === "LT" || vr === "UT" ? dataSet.text(tag) : dataSet.string(tag);
        let v = (s ?? "").replace(/\s+$/, "");
        if (vr === "IS" || vr === "DS") v = v.replace(/\\/g, " \\ ");
        // implicit VR: binary values can decode as garbage — detect and hex-preview
        if (!vr && v && [...v].some((ch) => ch.charCodeAt(0) < 9 || (ch.charCodeAt(0) > 13 && ch.charCodeAt(0) < 32) || ch.charCodeAt(0) === 0xfffd)) {
          const bytes = dataSet.byteArray.subarray(el.dataOffset, el.dataOffset + Math.min(len, 12));
          return `<${formatBytes(len)}> ${toHex(bytes)}…`;
        }
        if (v.length > 512) v = `${v.slice(0, 512)}…`;
        return v;
      }
    }
  } catch {
    return "(unreadable)";
  }
}

function prettyTag(tag: string): string {
  const t = tag.startsWith("x") ? tag.slice(1) : tag;
  return `(${t.slice(0, 4)},${t.slice(4)})`;
}

/* ================================ component =============================== */

export default function DicomViewer({ arrayBuffer, detected, fileName }: ViewerProps) {
  const [panel, setPanel] = React.useState<"image" | "tags">("image");
  const [error, setError] = React.useState<string | null>(null);
  const [dataSet, setDataSet] = React.useState<dicomParserMod.DataSet | null>(null);
  const [image, setImage] = React.useState<DicomImage | null>(null);
  const [imageNote, setImageNote] = React.useState<string | null>(null);
  const [win, setWin] = React.useState<{ c: number; w: number } | null>(null);
  const [invert, setInvert] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    if (arrayBuffer === null) {
      setError("DICOM file exceeds the in-browser load cap — full bytes unavailable.");
      return;
    }
    try {
      const ds = dicomParser.parseDicom(new Uint8Array(arrayBuffer));
      setDataSet(ds);
      let ts = "";
      try { ts = ds.string("x00020010") ?? ""; } catch { ts = ""; }
      const res = extractImage(ds, ts);
      if (res.ok) {
        setImage(res.image);
        setImageNote(null);
        setFrame(0);
      } else {
        setImage(null);
        setImageNote(res.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "DICOM parse failed");
    }
  }, [arrayBuffer]);

  // reset window/invert when a new image arrives
  React.useEffect(() => {
    if (!image) return;
    setInvert(image.monochromeInvert);
    if (image.kind === "gray") {
      const c = image.windowCenter;
      const w = image.windowWidth;
      if (c !== null && w !== null && w > 0) {
        setWin({ c, w });
      } else if (image.dataMin !== null && image.dataMax !== null) {
        setWin({ c: (image.dataMin + image.dataMax) / 2, w: Math.max(1, image.dataMax - image.dataMin) });
      } else {
        setWin({ c: 127.5, w: 255 });
      }
    } else {
      setWin(null);
    }
    setFrame(0);
  }, [image]);

  // canvas painter
  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c || !image) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = image.cols;
    c.height = image.rows;
    const out = ctx.createImageData(image.cols, image.rows);
    const data = out.data;
    if (image.kind === "rgb" && image.rgb) {
      const base = frame * image.rows * image.cols * 3;
      for (let i = 0, j = 0; i < image.rows * image.cols; i++, j += 4) {
        data[j] = image.rgb[base + i * 3];
        data[j + 1] = image.rgb[base + i * 3 + 1];
        data[j + 2] = image.rgb[base + i * 3 + 2];
        data[j + 3] = 255;
      }
    } else if (image.gray && win) {
      const base = frame * image.rows * image.cols;
      const w = Math.max(1e-6, win.w);
      const lo = win.c - 0.5 - (w - 1) / 2;
      const scale = 1 / (w - 1 || 1);
      for (let i = 0, j = 0; i < image.rows * image.cols; i++, j += 4) {
        let y = (image.gray[base + i] - lo) * scale;
        y = clamp(y, 0, 1);
        if (invert) y = 1 - y;
        const g = Math.round(y * 255);
        data[j] = g;
        data[j + 1] = g;
        data[j + 2] = g;
        data[j + 3] = 255;
      }
    } else {
      return;
    }
    ctx.putImageData(out, 0, 0);
  }, [image, win, invert, frame]);

  if (error) return <ErrorCard title="Could not parse DICOM" message={error} hint="Expected a DICOM Part 10 (.dcm) dataset." />;
  if (!dataSet) return <LoadingState label="Parsing DICOM dataset…" />;

  const modality = (dataSet.string("x00080060") ?? "??").toUpperCase();
  const patient = pnString(dataSet, "x00100010") ?? dataSet.string("x00100020") ?? "";
  const rows = image?.rows ?? 0;
  const cols = image?.cols ?? 0;
  let tsUid = "";
  try { tsUid = dataSet.string("x00020010") ?? ""; } catch { tsUid = ""; }
  const isColor = image?.kind === "rgb";

  const tagRows = Object.entries(dataSet.elements)
    .filter(([tag, el]) => !!tag && !!el && (el.length || el.items))
    .sort(([a], [b]) => a.localeCompare(b));

  const autoWindow = () => {
    if (image?.gray && image.dataMin !== null && image.dataMax !== null) {
      setWin({ c: (image.dataMin + image.dataMax) / 2, w: Math.max(1, image.dataMax - image.dataMin) });
    }
  };

  const cMin = image?.dataMin ?? 0;
  const cMax = image?.dataMax ?? 1;
  const wMax = Math.max(2, (image?.dataMax ?? 1) - (image?.dataMin ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.name}</Chip>
            <Chip tone="teal">{modality}</Chip>
            {rows ? <Chip tone="zinc">{rows}×{cols}{image && image.frames > 1 ? ` · ${image.frames}f` : ""}</Chip> : null}
            {tsUid ? <span title={tsUid}><Chip tone={imageNote ? "amber" : "zinc"}>{tsName(tsUid)}</Chip></span> : null}
          </>
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "image", label: "Image" },
              { value: "tags", label: `Tags (${tagRows.length})` },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {panel === "image" ? (
            image ? (
              <>
                <SectionCard
                  title="Pixel data"
                  icon={<Scan className="h-3.5 w-3.5" />}
                  right={
                    <div className="flex items-center gap-1.5">
                      <Chip tone="zinc">{image.photometric}</Chip>
                      <Chip tone="zinc">{image.bitsAllocated}-bit{image.signed ? " signed" : ""}</Chip>
                    </div>
                  }
                >
                  <div className="flex items-center justify-center overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4 scrollbar-thin">
                    <canvas
                      ref={canvasRef}
                      className="max-h-[60vh] max-w-full object-contain"
                      style={{ imageRendering: "pixelated" }}
                      aria-label="DICOM image render"
                    />
                  </div>

                  {image.kind === "gray" ? (
                    <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex min-w-56 flex-1 items-center gap-2 text-[11px] text-zinc-400">
                          <Contrast className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span className="w-14 shrink-0">Center</span>
                          <input
                            type="range"
                            min={cMin}
                            max={cMax}
                            step={(cMax - cMin) / 400 || 1}
                            value={win?.c ?? 0}
                            onChange={(e) => setWin((w) => (w ? { ...w, c: parseFloat(e.target.value) } : w))}
                            className="h-1.5 min-w-0 flex-1 accent-emerald-500"
                          />
                          <span className="w-14 shrink-0 text-right font-mono text-zinc-300">{(win?.c ?? 0).toFixed(1)}</span>
                        </label>
                        <ToolButton label="Reset" onClick={autoWindow} title="Auto window from pixel range">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </ToolButton>
                        <ToolButton label="Invert" active={invert} onClick={() => setInvert((v) => !v)} title="Toggle inversion">
                          <Contrast className="h-3.5 w-3.5" />
                        </ToolButton>
                      </div>
                      <label className="flex min-w-56 flex-1 items-center gap-2 text-[11px] text-zinc-400">
                        <Layers className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                        <span className="w-14 shrink-0">Width</span>
                        <input
                          type="range"
                          min={1}
                          max={wMax * 2}
                          step={Math.max(1, wMax / 400)}
                          value={win?.w ?? 1}
                          onChange={(e) => setWin((w) => (w ? { ...w, w: Math.max(1, parseFloat(e.target.value)) } : w))}
                          className="h-1.5 min-w-0 flex-1 accent-teal-500"
                        />
                        <span className="w-14 shrink-0 text-right font-mono text-zinc-300">{(win?.w ?? 1).toFixed(1)}</span>
                      </label>
                      {image.frames > 1 ? (
                        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                          <Layers className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          <span className="w-14 shrink-0">Frame</span>
                          <input
                            type="range"
                            min={0}
                            max={image.frames - 1}
                            step={1}
                            value={frame}
                            onChange={(e) => setFrame(parseInt(e.target.value, 10))}
                            className="h-1.5 min-w-0 flex-1 accent-amber-500"
                          />
                          <span className="w-14 shrink-0 text-right font-mono text-zinc-300">{frame + 1}/{image.frames}</span>
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  {image.frames > 1 && isColor ? (
                    <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3 text-[11px] text-zinc-400">
                      <Layers className="h-3.5 w-3.5 text-amber-500" />
                      <span className="w-14 shrink-0">Frame</span>
                      <input
                        type="range"
                        min={0}
                        max={image.frames - 1}
                        step={1}
                        value={frame}
                        onChange={(e) => setFrame(parseInt(e.target.value, 10))}
                        className="h-1.5 min-w-0 flex-1 accent-amber-500"
                      />
                      <span className="w-14 shrink-0 text-right font-mono text-zinc-300">{frame + 1}/{image.frames}</span>
                    </div>
                  ) : null}
                </SectionCard>

                <SectionCard title="Image parameters" icon={<Stethoscope className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Modality">{modality}</Field>
                    <Field label="Photometric">{image.photometric}</Field>
                    <Field label="Dimensions">{image.rows} × {image.cols} px{image.frames > 1 ? ` × ${image.frames} frames` : ""}</Field>
                    <Field label="Bits">{image.bitsAllocated} allocated / {image.bitsStored} stored{image.signed ? " (signed)" : ""}</Field>
                    {image.kind === "gray" ? (
                      <>
                        <Field label="Window C/W" mono>{win ? `${win.c.toFixed(1)} / ${win.w.toFixed(1)}` : "—"}</Field>
                        <Field label="Rescale" mono>
                          slope {image.rescaleSlope} · intercept {image.rescaleIntercept}
                        </Field>
                        <Field label="Value range" mono>
                          {image.dataMin !== null ? `${image.dataMin.toFixed(1)} … ${image.dataMax?.toFixed(1)}` : "—"}
                        </Field>
                      </>
                    ) : null}
                    {tsUid ? <Field label="Transfer syntax" mono><Copyable value={tsUid} /></Field> : null}
                  </InfoGrid>
                </SectionCard>
              </>
            ) : imageNote ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-900/50 bg-amber-950/20 p-5">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-400" />
                <div>
                  <div className="text-sm font-semibold text-amber-200">Pixel data not rendered</div>
                  <div className="mt-1 text-xs leading-relaxed text-amber-300/90">{imageNote}</div>
                  <div className="mt-2 text-[11px] text-zinc-400">Switch to the Tags panel for the full dataset dictionary.</div>
                </div>
              </div>
            ) : (
              <EmptyHint>No image data.</EmptyHint>
            )
          ) : null}

          {panel === "tags" ? (
            <>
              <SectionCard title="Patient / study" icon={<Stethoscope className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  <Field label="Patient">{patient || "—"}</Field>
                  <Field label="Modality">{modality}</Field>
                  <Field label="Study date">{dataSet.string("x00080020") ?? "—"}</Field>
                  <Field label="Study desc">{dataSet.string("x00081030") ?? "—"}</Field>
                  <Field label="Series desc">{dataSet.string("x0008103e") ?? "—"}</Field>
                  {tsUid ? <Field label="Transfer syntax">{tsName(tsUid)}</Field> : null}
                  {dataSet.warnings.length ? (
                    <Field label="Warnings">
                      <span className="text-amber-300">{dataSet.warnings.length} parser warning(s)</span>
                    </Field>
                  ) : null}
                </InfoGrid>
              </SectionCard>

              <SectionCard title="Element dictionary" icon={<TagIcon className="h-3.5 w-3.5" />} right={<Chip tone="zinc">{tagRows.length} elements</Chip>}>
                <div className="max-h-[60vh] overflow-auto scrollbar-thin">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-900">
                      <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                        <th className="px-2 py-1.5">Tag</th>
                        <th className="px-2 py-1.5">VR</th>
                        <th className="px-2 py-1.5">Name</th>
                        <th className="px-2 py-1.5">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tagRows.map(([tag, el]) => {
                        const value = tagValue(dataSet, el);
                        const name = TAG_NAMES[tag];
                        return (
                          <tr key={tag} className="border-b border-zinc-800/50 align-top hover:bg-zinc-900/40">
                            <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-emerald-300/90">{prettyTag(tag)}</td>
                            <td className="whitespace-nowrap px-2 py-1">
                              {el.vr ? <Chip tone="zinc">{el.vr}</Chip> : <span className="text-zinc-600">—</span>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1 text-zinc-400">{name ?? <span className="text-zinc-600">private/other</span>}</td>
                            <td className="max-w-[26rem] px-2 py-1 text-zinc-300">
                              {value.length > 80 ? <Copyable value={value} className="text-[11px]" /> : <span className="break-words">{value}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          ) : null}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <FileDigit className="h-3.5 w-3.5" />
        <span className="truncate">
          {tagRows.length} elements{image ? ` · ${image.rows}×${image.cols} render` : ""} · {fileName}
        </span>
      </div>
    </div>
  );
}
