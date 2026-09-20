"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, SectionCard, InfoGrid, Field, Chip, Segmented, Copyable, EmptyHint,
} from "./viewer-ui";
import { extractStrings, shannonEntropy, byteMap, formatBytes, formatNum, humanBitsPerByte, crc32, md5, sha256, toHex } from "@/lib/utils";
import { Fingerprint, Binary, FileSearch, Hash, Text, Microscope, Boxes } from "lucide-react";

export default function FallbackViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [panel, setPanel] = React.useState<"overview" | "strings" | "bytemap">("overview");
  const [strings, setStrings] = React.useState<{ offset: number; text: string }[] | null>(null);
  const [minLen, setMinLen] = React.useState(6);
  const [hashes, setHashes] = React.useState<{ md5: string; sha256: string; crc: number } | null>(null);
  const [entropy, setEntropy] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;

  React.useEffect(() => {
    setEntropy(shannonEntropy(bytes));
    let cancelled = false;
    (async () => {
      const [h256, crc] = [await sha256(bytes.subarray(0, Math.min(bytes.length, 50 * 1024 * 1024))), crc32(bytes.subarray(0, Math.min(bytes.length, 50 * 1024 * 1024)))];
      if (cancelled) return;
      setHashes({ md5: md5(bytes.subarray(0, Math.min(bytes.length, 50 * 1024 * 1024))), sha256: h256, crc });
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  React.useEffect(() => {
    if (panel !== "strings" || strings) return;
    setStrings(extractStrings(bytes, minLen));
  }, [panel]);  

  React.useEffect(() => {
    if (panel !== "bytemap") return;
    const c = canvasRef.current;
    if (!c) return;
    const rows = 128;
    const cols = 128;
    const cells = byteMap(bytes.subarray(0, 1024 * 1024), rows, cols);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = cols * dpr; c.height = rows * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < rows * cols; i++) {
      const v = cells[i];
      img.data[i * 4] = Math.floor(v * 255);
      img.data[i * 4 + 1] = Math.floor(v * 140 + 20);
      img.data[i * 4 + 2] = Math.floor(v * 60 + 10);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [panel, bytes]);

  const headHex = toHex(head.subarray(0, 32));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.name}</Chip>
            {detected.method !== "unknown" ? <Chip tone="teal">via {detected.method}</Chip> : <Chip tone="amber">unidentified</Chip>}
          </>
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "overview", label: "Overview" },
              { value: "strings", label: "Strings" },
              { value: "bytemap", label: "Byte map" },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        {panel === "overview" ? (
          <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2">
            <SectionCard title="Identification" icon={<Fingerprint className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Name">{detected.name}</Field>
                <Field label="Category">{detected.cat}</Field>
                <Field label="MIME">{detected.mime}</Field>
                <Field label="Detection">{detected.method}</Field>
                <Field label="Extension" mono>{detected.ext ? `.${detected.ext}` : "—"}</Field>
                <Field label="Magic bytes" mono>{detected.magicHex ?? "—"}</Field>
                <Field label="Head" mono>{headHex}…</Field>
              </InfoGrid>
              {detected.desc ? <p className="mt-3 border-t border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-400">{detected.desc}</p> : null}
              {detected.conflicts?.length ? (
                <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                  Note: extension suggests {detected.conflicts.join(", ")} — magic bytes win.
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="File profile" icon={<FileSearch className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Size">{formatBytes(file.size)} ({formatNum(file.size)} B)</Field>
                <Field label="Modified">{file.lastModified ? new Date(file.lastModified).toLocaleString() : "—"}</Field>
                <Field label="Entropy" mono>{entropy.toFixed(3)} / 8.000</Field>
                <Field label="Entropy class">{humanBitsPerByte(entropy)}</Field>
                <Field label="CRC32" mono>{hashes ? hashes.crc.toString(16).toUpperCase().padStart(8, "0") : "…"}</Field>
              </InfoGrid>
              {entropy >= 7.5 ? (
                <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                  High entropy — this region looks compressed or encrypted. Try renaming/extracting, or view raw bytes.
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Checksums" icon={<Hash className="h-3.5 w-3.5" />} className="lg:col-span-2">
              {hashes ? (
                <InfoGrid>
                  <Field label="MD5" mono><Copyable value={hashes.md5} /></Field>
                  <Field label="SHA-256" mono><Copyable value={hashes.sha256} /></Field>
                </InfoGrid>
              ) : (
                <EmptyHint>Computing…</EmptyHint>
              )}
            </SectionCard>
          </div>
        ) : null}

        {panel === "strings" ? (
          <div className="mx-auto max-w-4xl">
            <SectionCard
              title="Extracted strings"
              icon={<Text className="h-3.5 w-3.5" />}
              right={
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  min length
                  <input
                    type="number"
                    min={4}
                    max={16}
                    value={minLen}
                    onChange={(e) => {
                      setMinLen(Number(e.target.value));
                      setStrings(null);
                    }}
                    className="w-12 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-center text-zinc-200 outline-none"
                  />
                </div>
              }
            >
              {strings ? (
                strings.length ? (
                  <div className="max-h-[60vh] overflow-y-auto font-mono text-[11px] scrollbar-thin">
                    {strings.map((s, i) => (
                      <div key={i} className="flex gap-3 border-b border-zinc-800/40 py-1 hover:bg-zinc-900/40">
                        <span className="w-20 shrink-0 text-right text-zinc-600">{s.offset.toString(16).padStart(6, "0")}</span>
                        <span className="min-w-0 break-all text-zinc-300">{s.text.length > 300 ? s.text.slice(0, 300) + "…" : s.text}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyHint>No ASCII strings of length ≥ {minLen} in first 2 MB.</EmptyHint>
                )
              ) : (
                <EmptyHint>Scanning…</EmptyHint>
              )}
            </SectionCard>
          </div>
        ) : null}

        {panel === "bytemap" ? (
          <div className="mx-auto max-w-3xl">
            <SectionCard title="Byte density map" icon={<Microscope className="h-3.5 w-3.5" />}>
              <canvas ref={canvasRef} className="w-full rounded border border-zinc-800" style={{ imageRendering: "pixelated" }} />
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Each pixel averages 64 bytes of the first megabyte. Brighter = higher byte values. Uniform blocks reveal structure;
                noise reveals compression or encryption; horizontal banding reveals padding.
              </p>
            </SectionCard>
            <SectionCard title="Structure hints" icon={<Boxes className="h-3.5 w-3.5" />} className="mt-4">
              <InfoGrid>
                <Field label="First bytes" mono>{toHex(head.subarray(0, 16))}</Field>
                <Field label="ASCII prefix">{new TextDecoder("latin1").decode(head.subarray(0, 16)).replace(/[^\x20-\x7e]/g, "·")}</Field>
                <Field label="Trailing" mono>{arrayBuffer ? toHex(new Uint8Array(arrayBuffer).subarray(Math.max(0, arrayBuffer.byteLength - 16))) : "—"}</Field>
              </InfoGrid>
            </SectionCard>
          </div>
        ) : null}
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Binary className="h-3.5 w-3.5" />
        <span>Switch to Hex view for byte-level navigation · {fileName}</span>
      </div>
    </div>
  );
}
