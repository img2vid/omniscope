"use client";

import * as React from "react";
import * as opentype from "opentype.js";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, Segmented, ToolButton,
} from "./viewer-ui";
import { cn, formatBytes, formatNum } from "@/lib/utils";
import { Type, Grid3x3, Info, ChevronDown, AlertTriangle, Palette } from "lucide-react";

/* ================================ helpers ================================ */

const FONT_MIMES: Record<string, string> = {
  ttf: "font/ttf", otf: "font/otf", ttc: "font/collection", woff: "font/woff", woff2: "font/woff2",
};

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin", 200: "Extra-light", 300: "Light", 400: "Normal / Regular", 500: "Medium",
  600: "Semi-bold", 700: "Bold", 800: "Extra-bold", 900: "Black",
};

function nameOf(names: Record<string, unknown> | undefined, key: string): string {
  try {
    const v = (names as Record<string, unknown> | undefined)?.[key];
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      if (typeof obj.en === "string") return obj.en;
      const values = Object.values(obj);
      if (values.length) {
        const first = values[0];
        if (typeof first === "string") return first;
        if (Array.isArray(first) && first.length && typeof first[0] === "string") return first[0];
      }
      if (Array.isArray(v) && v.length) {
        const item = v[0] as Record<string, unknown>;
        if (typeof item?.en === "string") return item.en;
        const iv = Object.values(item ?? {});
        if (iv.length && typeof iv[0] === "string") return iv[0] as string;
      }
    }
  } catch { /* fall through */ }
  return "";
}

function fsTypeLabel(t: number): string {
  if (t === 0) return "Installable embedding (no restrictions)";
  const bits: string[] = [];
  if (t & 0x2) bits.push("Restricted license");
  if (t & 0x4) bits.push("Preview & print only");
  if (t & 0x8) bits.push("Editable embedding");
  if (t & 0x100) bits.push("No subsetting");
  if (t & 0x200) bits.push("Bitmap embedding only");
  return (bits.length ? bits.join(" · ") : "unknown") + ` (0x${t.toString(16)})`;
}

/* ================================ glyph cell ================================ */

function GlyphCell({ glyph, family }: { glyph: unknown; family: string }) {
  const g = glyph as {
    index: number;
    unicode?: number | null;
    getPath?: (x: number, y: number, size: number) => { toPathData: (d: number) => string };
  };
  const d = React.useMemo(() => {
    try {
      const p = g.getPath?.(4, 22, 18);
      return p ? p.toPathData(2) : "";
    } catch {
      return "";
    }
  }, [g]);
  const uni = typeof g.unicode === "number" ? g.unicode : null;
  const printable = uni != null && uni >= 0x20 && uni !== 0x7f && !(uni >= 0xd800 && uni <= 0xdfff);
  return (
    <div className="flex flex-col items-center gap-1 rounded border border-zinc-800 bg-zinc-950/50 p-1.5 transition-colors hover:border-emerald-800/60">
      <svg viewBox="0 0 28 28" className="h-9 w-9 shrink-0" aria-hidden>
        {d ? (
          <path d={d} fill="currentColor" className="text-emerald-300/90" />
        ) : (
          <text x="14" y="18" textAnchor="middle" fontSize="10" fill="#52525b">?</text>
        )}
      </svg>
      <div className="font-mono text-[9px] leading-3 text-zinc-500">
        {uni != null ? `U+${uni.toString(16).toUpperCase().padStart(4, "0")}` : `#${g.index}`}
      </div>
      {printable ? (
        <div className="h-4 text-sm leading-4 text-zinc-300" style={{ fontFamily: `"${family}"` }}>
          {String.fromCodePoint(uni)}
        </div>
      ) : (
        <div className="h-4" />
      )}
    </div>
  );
}

/* ================================= viewer ================================= */

const PRESETS: { label: string; text: string }[] = [
  { label: "Pangram", text: "The quick brown fox jumps over the lazy dog — 0123456789 !?&@#" },
  { label: "Alphabet", text: "ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz" },
  { label: "Digits", text: "0123456789\n¼ ½ ¾ ⅓ ⅔ ± × ÷ = ≠ ≈ < > ≤ ≥ ∑ ∞ √" },
];

export default function FontViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [panel, setPanel] = React.useState<"preview" | "glyphs" | "info">("preview");
  const [font, setFont] = React.useState<unknown | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [woff2, setWoff2] = React.useState<{ flavor: string; length: number; numTables: number } | null>(null);
  const [size, setSize] = React.useState(28);
  const [text, setText] = React.useState(PRESETS[0].text);
  const [glyphCount, setGlyphCount] = React.useState(200);
  const [ready, setReady] = React.useState(false);
  const family = React.useRef(`omni-font-${Math.random().toString(36).slice(2, 9)}`).current;

  const f = font as {
    unitsPerEm?: number; ascender?: number; descender?: number; numGlyphs?: number;
    outlinesFormat?: string; names?: Record<string, unknown>; tables?: Record<string, any>;
    glyphs?: { get: (i: number) => unknown; length: number };
  } | null;

  /* ---- parse ---- */
  React.useEffect(() => {
    setFont(null);
    setParseError(null);
    setWoff2(null);
    setReady(false);
    setGlyphCount(200);
    if (!arrayBuffer) {
      setParseError("File exceeds the in-memory load cap — font parsing needs the complete file.");
      setReady(true);
      return;
    }
    const bytes = new Uint8Array(arrayBuffer);
    const sig = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    if (sig === "wOF2") {
      try {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const rawFlavor = dv.getUint32(4, false);
        const flavor =
          rawFlavor === 0x00010000 ? "TrueType outlines (0x00010000)" :
          rawFlavor === 0x4f54544f ? "CFF outlines (OTTO)" :
          rawFlavor === 0x74727565 ? "Apple 'true'" : `0x${rawFlavor.toString(16).padStart(8, "0")}`;
        setWoff2({ flavor, length: dv.getUint32(8, false), numTables: dv.getUint16(12, false) });
      } catch {
        setWoff2({ flavor: "unreadable", length: arrayBuffer.byteLength, numTables: 0 });
      }
      setReady(true);
      return;
    }
    try {
      setFont(opentype.parse(arrayBuffer));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
    setReady(true);
  }, [arrayBuffer]);

  /* ---- blob url + @font-face ---- */
  const fontUrl = React.useMemo(() => {
    if (!arrayBuffer) return null;
    const ext = (fileName.split(".").pop() ?? "").toLowerCase();
    return URL.createObjectURL(new Blob([arrayBuffer], { type: FONT_MIMES[ext] ?? "font/ttf" }));
  }, [arrayBuffer, fileName]);

  React.useEffect(() => {
    return () => { if (fontUrl) URL.revokeObjectURL(fontUrl); };
  }, [fontUrl]);

  React.useEffect(() => {
    if (!fontUrl) return;
    const el = document.createElement("style");
    el.textContent = `@font-face { font-family: "${family}"; src: url("${fontUrl}"); font-display: block; }`;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, [fontUrl, family]);

  const glyphList = React.useMemo(() => {
    if (!f?.glyphs) return [] as unknown[];
    const total = Math.min(f.numGlyphs ?? 0, glyphCount);
    const out: unknown[] = [];
    for (let i = 0; i < total; i++) {
      try { out.push(f.glyphs.get(i)); } catch { break; }
    }
    return out;
  }, [f, glyphCount]);

  if (!arrayBuffer && !ready) return <LoadingState label="Loading font…" />;
  if (!arrayBuffer) {
    return (
      <ErrorCard
        title="Font file too large"
        message="This file exceeds the in-memory load cap (96 MB) — font parsing and live preview need the complete file in memory."
      />
    );
  }
  if (!ready) return <LoadingState label="Parsing font…" />;

  const familyName = nameOf(f?.names, "fontFamily") || (fileName.replace(/\.[^.]+$/, ""));
  const os2 = f?.tables?.os2 as { usWeightClass?: number; fsType?: number } | undefined;
  const cmapCount = f?.tables?.cmap?.glyphIndexMap ? Object.keys(f.tables.cmap.glyphIndexMap).length : 0;
  const formatChip = woff2 ? "WOFF2" : detected.ext === "woff" ? "WOFF" : detected.ext === "otf" ? "OTF / CFF" : detected.ext === "ttc" ? "TTC" : f?.outlinesFormat === "cff" ? "CFF outlines" : "TrueType";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Type className="h-3 w-3" />{familyName.slice(0, 28)}</Chip>
            <Chip>{formatChip}</Chip>
            {f?.numGlyphs ? <Chip tone="teal">{formatNum(f.numGlyphs)} glyphs</Chip> : null}
            {woff2 ? <Chip tone="amber">Brotli — metrics off</Chip> : null}
          </>
        }
        center={
          panel === "preview" ? (
            <div className="flex h-7 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-400">
              <span className="hidden text-zinc-500 sm:inline">Size</span>
              <input
                type="range"
                min={16}
                max={72}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                className="h-1 w-24 cursor-pointer accent-emerald-500"
                aria-label="Preview size"
              />
              <span className="w-9 tabular-nums text-zinc-200">{size}px</span>
            </div>
          ) : undefined
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "preview", label: "Preview" },
              { value: "glyphs", label: "Glyphs" },
              { value: "info", label: "Info" },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {panel === "preview" ? (
            <SectionCard
              title="Live type preview"
              icon={<Palette className="h-3.5 w-3.5" />}
              right={
                <div className="flex items-center gap-1">
                  {PRESETS.map((p) => (
                    <ToolButton key={p.label} label={p.label} onClick={() => setText(p.text)}>{p.label}</ToolButton>
                  ))}
                </div>
              }
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                style={{ fontFamily: `"${family}", monospace`, fontSize: size, lineHeight: 1.5 }}
                className="min-h-[34vh] w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-zinc-100 outline-none transition-colors focus:border-emerald-800/60 scrollbar-thin"
                aria-label="Typeable font preview"
              />
              <div className="mt-4 space-y-2.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                {[16, 24, 40].map((s) => (
                  <div key={s} className="flex items-baseline gap-3">
                    <span className="w-8 shrink-0 font-mono text-[10px] text-zinc-600">{s}px</span>
                    <div className="min-w-0 truncate text-zinc-200" style={{ fontFamily: `"${family}", monospace`, fontSize: s }}>
                      {text.split("\n")[0] || "The quick brown fox jumps over the lazy dog"}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                Rendered through an @font-face rule fed by an in-memory blob URL — the file never leaves your browser.
                {parseError ? " Metrics and glyph outlines are unavailable (parser failed), but the visual preview can still work if the browser supports the format." : ""}
              </p>
            </SectionCard>
          ) : null}

          {panel === "glyphs" ? (
            <SectionCard
              title="Glyph map"
              icon={<Grid3x3 className="h-3.5 w-3.5" />}
              right={f?.numGlyphs ? <Chip>{formatNum(Math.min(glyphCount, f.numGlyphs))} / {formatNum(f.numGlyphs)}</Chip> : undefined}
            >
              {f?.glyphs && f.numGlyphs ? (
                <>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
                    {glyphList.map((g, i) => (
                      <GlyphCell key={i} glyph={g} family={family} />
                    ))}
                  </div>
                  {glyphCount < f.numGlyphs ? (
                    <div className="pt-3">
                      <ToolButton
                        onClick={() => setGlyphCount((c) => c + 200)}
                        label={`Load 200 more (${formatNum(f.numGlyphs - glyphCount)} hidden)`}
                        className="w-full justify-center border border-zinc-800"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </ToolButton>
                    </div>
                  ) : null}
                </>
              ) : woff2 ? (
                <EmptyHint>
                  Glyph outlines require decompressing the Brotli streams inside WOFF2 — not available in this viewer yet.
                </EmptyHint>
              ) : (
                <EmptyHint>Glyph map unavailable — the font could not be parsed ({parseError ?? "no glyph data"}).</EmptyHint>
              )}
            </SectionCard>
          ) : null}

          {panel === "info" ? (
            <>
              {f ? (
                <SectionCard title="Metrics & identity" icon={<Info className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Family">{nameOf(f.names, "fontFamily") || "—"}</Field>
                    <Field label="Subfamily">{nameOf(f.names, "fontSubfamily") || "—"}</Field>
                    <Field label="Full name">{nameOf(f.names, "fullName") || "—"}</Field>
                    <Field label="PostScript name" mono>{nameOf(f.names, "postScriptName") || "—"}</Field>
                    <Field label="Version">{nameOf(f.names, "version") || "—"}</Field>
                    <Field label="Designer">{nameOf(f.names, "designer") || "—"}</Field>
                    <Field label="Manufacturer">{nameOf(f.names, "manufacturer") || "—"}</Field>
                    <Field label="Outlines">{f.outlinesFormat === "cff" ? "CFF (PostScript Type 2)" : f.outlinesFormat === "truetype" ? "TrueType quadratic" : f.outlinesFormat ?? "—"}</Field>
                    <Field label="Units per em">{formatNum(f.unitsPerEm ?? 0)}</Field>
                    <Field label="Ascender / Descender" mono>{f.ascender ?? "—"} / {f.descender ?? "—"}</Field>
                    <Field label="Total glyphs">{formatNum(f.numGlyphs ?? 0)}</Field>
                    <Field label="Characters mapped">{formatNum(cmapCount)}</Field>
                    <Field label="Weight class">{os2?.usWeightClass != null ? `${os2.usWeightClass} (${WEIGHT_NAMES[os2.usWeightClass] ?? "custom"})` : "—"}</Field>
                    <Field label="Embedding">{os2?.fsType != null ? fsTypeLabel(os2.fsType) : "—"}</Field>
                  </InfoGrid>
                </SectionCard>
              ) : woff2 ? (
                <SectionCard title="WOFF2 header" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Format">WOFF2 — Brotli-compressed web font</Field>
                    <Field label="Original flavor">{woff2.flavor}</Field>
                    <Field label="Total length">{formatBytes(woff2.length)}</Field>
                    <Field label="Tables">{formatNum(woff2.numTables)}</Field>
                  </InfoGrid>
                  <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-300/90">
                    WOFF2 table data is Brotli-compressed; metrics are unavailable until it is decompressed. The live preview above
                    still renders because the browser itself supports WOFF2 natively.
                  </div>
                </SectionCard>
              ) : (
                <SectionCard title="Parser failed" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Error" mono>{parseError ?? "unknown"}</Field>
                    <Field label="File size">{formatBytes(file.size)}</Field>
                  </InfoGrid>
                  <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                    OpenType parsing failed — the file may be a font collection (TTC), use an exotic table layout, or be corrupted.
                    The visual preview may still work through the browser&apos;s own font engine.
                  </p>
                </SectionCard>
              )}
              <SectionCard title="File">
                <InfoGrid>
                  <Field label="Detected as">{detected.name}</Field>
                  <Field label="MIME">{detected.mime || "—"}</Field>
                  <Field label="Size">{formatBytes(file.size)} ({formatNum(file.size)} B)</Field>
                  <Field label="Extension" mono>{detected.ext ? `.${detected.ext}` : "—"}</Field>
                </InfoGrid>
              </SectionCard>
            </>
          ) : null}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Type className="h-3.5 w-3.5" />
        <span className={cn("truncate")}>{familyName} · {formatBytes(file.size)} · {fileName}</span>
      </div>
    </div>
  );
}
