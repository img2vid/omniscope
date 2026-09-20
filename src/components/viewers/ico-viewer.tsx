"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, Chip, SectionCard, InfoGrid, Field, ErrorCard,
} from "./viewer-ui";
import { Image as ImageIcon, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface IcoImage { width: number; height: number; dataUrl: string; bitDepth?: number; size: number; format: string; }

/** Parse ICO/CUR container (PNG-embedded and BMP entries). */
function parseIco(bytes: Uint8Array, isCur: boolean): IcoImage[] {
  const images: IcoImage[] = [];
  const count = bytes[4] | (bytes[5] << 8);
  const base = bytes.byteOffset;
  for (let i = 0; i < count && i < 32; i++) {
    const e = 6 + i * 16;
    const w = bytes[e] || 256;
    const h = bytes[e + 1] || 256;
    const bitDepth = bytes[e + 6] | (bytes[e + 7] << 8);
    const size = bytes[e + 8] | (bytes[e + 9] << 8) | (bytes[e + 10] << 16) | (bytes[e + 11] << 24);
    const off = bytes[e + 12] | (bytes[e + 13] << 8) | (bytes[e + 14] << 16) | (bytes[e + 15] << 24);
    if (off + 8 > bytes.length) continue;
    const sub = bytes.subarray(off, off + size);
    if (sub[0] === 0x89 && sub[1] === 0x50) {
      images.push({ width: w, height: h, dataUrl: URL.createObjectURL(new Blob([new Uint8Array(sub)], { type: "image/png" })), bitDepth, size, format: "PNG" });
    } else if (sub[0] === 0x28 && sub[1] === 0x00) {
      // BITMAPINFOHEADER (height is doubled for color+mask)
      try {
        const dv = new DataView(sub.buffer, sub.byteOffset, Math.min(sub.byteLength, 40));
        const width = dv.getInt32(4, true);
        const height = Math.abs(dv.getInt32(8, true)) / 2;
        const bpp = dv.getUint16(14, true);
        const palSize = bpp <= 8 ? (dv.getUint32(32, true) || (1 << bpp)) * 4 : 0;
        const px = sub.subarray(40 + palSize);
        const c = document.createElement("canvas");
        c.width = width; c.height = height;
        const ctx = c.getContext("2d")!;
        const idata = ctx.createImageData(width, height);
        if (bpp === 32 || bpp === 24) {
          const rowSize = Math.ceil((bpp * width) / 32) * 4;
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const sIdx = (height - 1 - y) * rowSize + x * (bpp / 8);
              const dIdx = (y * width + x) * 4;
              if (sIdx + 3 < px.length) {
                if (bpp === 32) {
                  idata.data[dIdx] = px[sIdx + 2];
                  idata.data[dIdx + 1] = px[sIdx + 1];
                  idata.data[dIdx + 2] = px[sIdx];
                  const alpha = px[sIdx + 3];
                  // BGRA with straight alpha? Some ICOs premultiply; keep as-is
                  idata.data[dIdx + 3] = alpha;
                } else {
                  idata.data[dIdx] = px[sIdx + 2];
                  idata.data[dIdx + 1] = px[sIdx + 1];
                  idata.data[dIdx + 2] = px[sIdx];
                  idata.data[dIdx + 3] = 255;
                }
              }
            }
          }
        } else if (bpp <= 8) {
          const palette = sub.subarray(40, 40 + palSize);
          const rowSize = Math.ceil((bpp * width) / 32) * 4;
          const mask = px.subarray(rowSize * height);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const byteIdx = Math.floor((x * bpp) / 8);
              const bitOff = 8 - bpp - ((x * bpp) % 8);
              let idx = 0;
              if (bpp === 8) idx = px[y * rowSize + x];
              else if (bpp === 4) idx = (px[y * rowSize + byteIdx] >> bitOff) & 0xf;
              else idx = (px[y * rowSize + byteIdx] >> (7 - x % 8)) & 1;
              const p = idx * 4;
              const dIdx = (y * width + x) * 4;
              if (p + 2 < palette.length) {
                idata.data[dIdx] = palette[p + 2];
                idata.data[dIdx + 1] = palette[p + 1];
                idata.data[dIdx + 2] = palette[p];
              }
              idata.data[dIdx + 3] = 255;
              const maskRow = Math.ceil(width / 32) * 4;
              const mBit = 7 - (x % 8);
              const mByte = y * maskRow + Math.floor(x / 8);
              if (mByte < mask.length && (mask[mByte] >> mBit) & 1) idata.data[dIdx + 3] = 0;
            }
          }
        }
        ctx.putImageData(idata, 0, 0);
        images.push({ width, height, dataUrl: c.toDataURL("image/png"), bitDepth: bpp, size, format: `BMP ${bpp}bpp` });
      } catch { /* skip broken entry */ }
    }
  }
  return images;
}

export default function IcoViewer({ file, arrayBuffer, head, detected }: ViewerProps) {
  const [images, setImages] = React.useState<IcoImage[] | null>(null);

  React.useEffect(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const isCur = detected.record?.key === "cur";
    setImages(parseIco(bytes, isCur));
  }, [arrayBuffer, head, detected]);

  if (!images) return <div className="flex h-full items-center justify-center text-xs text-zinc-500">Parsing icon container…</div>;
  if (images.length === 0) return <ErrorCard title="No decodable icon frames" message="Container recognized but entries use unsupported compression." />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar left={<>
        <Chip tone="emerald">{detected.record?.key === "cur" ? "Cursor" : "Icon"}</Chip>
        <Chip>{images.length} frame(s)</Chip>
      </>} />
      <ViewerBody className="p-6">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img, i) => (
            <div key={i} className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-center transition-colors hover:border-emerald-800/60">
              <div className="flex h-24 items-center justify-center">
                {}
                <img
                  src={img.dataUrl}
                  alt={`${img.width}×${img.height} frame`}
                  style={{ width: Math.min(96, img.width), height: "auto", imageRendering: "auto" }}
                  className={cn("drop-shadow-lg", img.width <= 32 && "[image-rendering:pixelated]")}
                />
              </div>
              <div className="mt-3 font-mono text-xs text-zinc-300">{img.width} × {img.height}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500">{img.format} · {img.bitDepth}bpp · {(img.size / 1024).toFixed(1)} KB</div>
            </div>
          ))}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Layers className="h-3.5 w-3.5" />
        <span>Every embedded resolution decoded</span>
        <ImageIcon className="ml-auto h-3.5 w-3.5" />
      </div>
    </div>
  );
}
