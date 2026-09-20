"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState,
  Segmented, Chip, InfoGrid, Field, SectionCard,
} from "./viewer-ui";
import { decodeCP437, decodeWith, isLikelyValidUtf8, downloadBlob, formatBytes, formatNum, accentCss, accentSolid, observeAccent } from "@/lib/utils";
import {
  Terminal, Copy, Download, Check, Type, Monitor, FileText, Ruler, ImageDown,
} from "lucide-react";

/* ================================ helpers ================================ */

const RENDER_CAP = 2_000_000; // chars rendered in the terminal pane

function countBoxChars(bytes: Uint8Array): number {
  let n = 0;
  const limit = Math.min(bytes.length, 4 * 1024 * 1024);
  for (let i = 0; i < limit; i++) {
    const b = bytes[i];
    if ((b >= 0xb0 && b <= 0xdf) || b === 0xfe) n++;
  }
  return n;
}

const COLOR_MODES = {
  emerald: {
    label: "Green",
    text: "#6ee7b7",
    glow: "0 0 8px rgba(16,185,129,0.45)",
    glowColor: "rgba(16,185,129,0.45)",
    icon: <Terminal className="h-3.5 w-3.5" />,
  },
  accent: {
    label: "Accent",
    get text() { return accentSolid(300, "#6ee7b7"); },
    get glow() { return `0 0 8px ${accentCss(500, 0.45)}`; },
    get glowColor() { return accentCss(500, 0.45); },
    icon: <Terminal className="h-3.5 w-3.5" />,
  },
  amber: {
    label: "Amber",
    text: "#fcd34d",
    glow: "0 0 8px rgba(245,158,11,0.40)",
    glowColor: "rgba(245,158,11,0.40)",
    icon: <Terminal className="h-3.5 w-3.5" />,
  },
  zinc: {
    label: "Mono",
    text: "#d4d4d8",
    glow: "none",
    glowColor: null,
    icon: <Terminal className="h-3.5 w-3.5" />,
  },
} as const;

type ColorMode = keyof typeof COLOR_MODES;

const BG_MODES = {
  black: { label: "Black", fill: "#000000", paper: false },
  zinc: { label: "Dark", fill: "#121214", paper: false },
  paper: { label: "Paper", fill: "#f7f6f2", paper: true },
} as const;

type BgMode = keyof typeof BG_MODES;

/** resolved render colors for the current text-color + background combo */
function resolveInk(mode: (typeof COLOR_MODES)[ColorMode], bg: BgMode): { text: string; glow: string; glowColor: string | null; scanlines: boolean } {
  const b = BG_MODES[bg];
  if (b.paper) {
    return { text: "#1c1917", glow: "none", glowColor: null, scanlines: false };
  }
  return { text: mode.text, glow: mode.glow, glowColor: mode.glowColor, scanlines: true };
}

/* ================================ component =============================== */

export default function NfoViewer({ arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [color, setColor] = React.useState<ColorMode>("accent");
  /* live accent: re-render when the palette flips so Accent ink follows the picker */
  const [, setAccentTick] = React.useState(0);
  React.useEffect(() => observeAccent(() => setAccentTick((t) => t + 1)), []);
  const [bg, setBg] = React.useState<BgMode>("black");
  const [size, setSize] = React.useState(14);
  const [crt, setCrt] = React.useState(true);
  const [charset, setCharset] = React.useState<"cp437" | "utf-8">("cp437");
  const [copied, setCopied] = React.useState(false);
  const [pngNote, setPngNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [text, setText] = React.useState<string | null>(null);

  const bytes = React.useMemo(
    () => (arrayBuffer ? new Uint8Array(arrayBuffer) : head),
    [arrayBuffer, head],
  );

  // initial charset guess: CP437 unless the bytes are clearly multi-byte UTF-8
  React.useEffect(() => {
    const hasHigh = bytes.some((b) => b >= 0x80);
    if (hasHigh && isLikelyValidUtf8(bytes)) setCharset("utf-8");
  }, [bytes]);

  React.useEffect(() => {
    try {
      if (bytes.length === 0) throw new Error("File is empty");
      setText(charset === "cp437" ? decodeCP437(bytes) : decodeWith(bytes, "utf-8"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bytes, charset]);

  if (error) return <ErrorCard title="Could not decode NFO" message={error} />;
  if (text === null) return <LoadingState label="Decoding NFO…" />;

  const lines = text.split("\n");
  const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
  const boxChars = countBoxChars(bytes);
  const truncated = text.length > RENDER_CAP;
  const renderText = truncated ? text.slice(0, RENDER_CAP) : text;
  const mode = COLOR_MODES[color];
  const ink = resolveInk(mode, bg);

  const copyText = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => { /* clipboard unavailable */ });
  };

  const downloadTxt = () => {
    const base = fileName.replace(/\.[^.]+$/, "") || "nfo";
    downloadBlob(text, `${base}.txt`, "text/plain;charset=utf-8");
  };

  /* render the terminal view (color mode, font size, CRT) to a PNG and download it */
  const exportPng = () => {
    setPngNote(null);
    try {
      const font = `${size}px "Courier New", ui-monospace, Menlo, monospace`;
      const probe = document.createElement("canvas").getContext("2d");
      if (!probe) throw new Error("Canvas unavailable");
      probe.font = font;
      const charW = probe.measureText("M").width || size * 0.6;
      const lineHeight = Math.round(size * 1.25);
      const lines = renderText.split("\n");
      let longest = 1;
      for (const l of lines) if (l.length > longest) longest = l.length;
      const pad = Math.round(size * 1.5);
      const baseW = Math.ceil(longest * charW + pad * 2);
      const baseH = Math.ceil(lines.length * lineHeight + pad * 2);
      const MAX_AREA = 40_000_000; // ~40 MP guard
      const MAX_SIDE = 16384; // browser canvas dimension guard
      let effScale = Math.min(2, Math.sqrt(MAX_AREA / (baseW * baseH)), MAX_SIDE / baseW, MAX_SIDE / baseH);
      let note: string | null = null;
      if (effScale < 0.5) {
        // too tall even at half scale → truncate lines to fit
        effScale = 0.5;
        const maxLines = Math.floor((MAX_SIDE / effScale - pad * 2) / lineHeight);
        if (lines.length > maxLines) {
          note = `PNG truncated to first ${maxLines.toLocaleString()} lines`;
          lines.length = maxLines;
        }
      }
      const width = Math.ceil(baseW * effScale);
      const height = Math.ceil(baseH * effScale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      // background: classic black CRT / dark zinc / paper light
      ctx.fillStyle = BG_MODES[bg].fill;
      ctx.fillRect(0, 0, width, height);
      ctx.scale(effScale, effScale);
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = ink.text;
      if (ink.glowColor) {
        ctx.shadowColor = ink.glowColor;
        ctx.shadowBlur = size * 0.55;
      }
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], pad, pad + (i + 0.85) * lineHeight);
      }
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      if (crt && ink.scanlines) {
        ctx.fillStyle = bg === "zinc" ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.22)";
        const step = 3 * effScale;
        const barH = Math.max(1, effScale);
        for (let y = 0; y < height; y += step) ctx.fillRect(0, y, width, barH);
      }
      canvas.toBlob((blob) => {
        if (!blob) { setPngNote("PNG export failed"); return; }
        const base = fileName.replace(/\.[^.]+$/, "") || "nfo";
        downloadBlob(blob, `${base}.png`, "image/png");
        setPngNote(note ?? `Saved ${width.toLocaleString()}×${height.toLocaleString()} PNG`);
      }, "image/png");
    } catch (e) {
      setPngNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.name}</Chip>
            <Chip tone={charset === "cp437" ? "teal" : "zinc"}>{charset === "cp437" ? "CP437" : "UTF-8"}</Chip>
            <Chip tone="zinc">{formatNum(lines.length)} lines</Chip>
            {boxChars ? <Chip tone="amber">{formatNum(boxChars)} box chars</Chip> : null}
          </>
        }
        center={
          <>
            <Segmented
              value={color}
              onChange={(v) => setColor(v)}
              options={[
                { value: "accent", label: "Accent" },
                { value: "emerald", label: "Green" },
                { value: "amber", label: "Amber" },
                { value: "zinc", label: "Mono" },
              ]}
            />
            <Segmented
              value={bg}
              onChange={(v) => setBg(v)}
              options={[
                { value: "black", label: "Black" },
                { value: "zinc", label: "Dark" },
                { value: "paper", label: "Paper" },
              ]}
            />
            <ToolButton
              label={charset === "cp437" ? "CP437" : "UTF-8"}
              onClick={() => setCharset((c) => (c === "cp437" ? "utf-8" : "cp437"))}
              title="Toggle character set decoding"
            >
              <Type className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
        right={
          <>
            <div className="flex h-7 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2">
              <Ruler className="h-3.5 w-3.5 text-zinc-500" />
              <input
                type="range"
                min={10}
                max={22}
                step={1}
                value={size}
                onChange={(e) => setSize(parseInt(e.target.value, 10))}
                className="h-1.5 w-20 accent-emerald-500"
                aria-label="Font size"
              />
              <span className="w-8 text-right font-mono text-[11px] text-zinc-400">{size}px</span>
            </div>
            <ToolButton label="CRT" active={crt} onClick={() => setCrt((v) => !v)} title={bg === "paper" ? "Scanline overlay (dark backgrounds only)" : "Toggle scanline overlay"}>
              <Monitor className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Copy" onClick={copyText} title="Copy full text">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton label="Save .txt" onClick={downloadTxt} title="Download as UTF-8 text">
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Save .png" onClick={exportPng} title="Render terminal view to PNG (color, size, background and CRT as configured)">
              <ImageDown className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-6xl">
          <div
            className="relative overflow-hidden rounded-lg border shadow-[inset_0_0_70px_rgba(0,0,0,0.8)]"
            style={{ backgroundColor: BG_MODES[bg].fill, borderColor: bg === "paper" ? "#d6d3d1" : "rgba(63,63,70,0.7)" }}
          >
            {crt && ink.scanlines ? (
              <div
                className="pointer-events-none absolute inset-0 z-10 opacity-60"
                style={{
                  background:
                    "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)",
                }}
                aria-hidden
              />
            ) : null}
            <div className="max-h-[calc(100vh-14rem)] overflow-auto scrollbar-thin">
              <pre
                className="m-0 min-w-max whitespace-pre p-4 font-mono leading-[1.25]"
                style={{
                  fontSize: `${size}px`,
                  color: ink.text,
                  textShadow: ink.glow,
                  whiteSpace: "pre",
                  overflowWrap: "normal",
                  wordBreak: "keep-all",
                }}
              >
                {renderText}
              </pre>
            </div>
            {truncated ? (
              <div className="border-t border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-[11px] text-amber-300/80">
                Rendering first {formatBytes(RENDER_CAP)} — full text available via Copy / Save.
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SectionCard title="File statistics" icon={<FileText className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Size">{formatBytes(bytes.length)} ({formatNum(bytes.length)} B)</Field>
                <Field label="Lines">{formatNum(lines.length)}</Field>
                <Field label="Longest line">{formatNum(longest)} chars</Field>
                <Field label="Box-drawing chars">{formatNum(boxChars)}</Field>
                <Field label="Encoding">{charset === "cp437" ? "IBM CP437 (classic DOS NFO)" : "UTF-8 (modern NFO)"}</Field>
                <Field label="Bytes ≥ 0x80">{formatNum(bytes.reduce((a, b) => a + (b >= 0x80 ? 1 : 0), 0))}</Field>
              </InfoGrid>
            </SectionCard>
            <SectionCard title="About NFO rendering" icon={<Terminal className="h-3.5 w-3.5" />}>
              <p className="text-xs leading-relaxed text-zinc-400">
                Classic scene NFO files use the IBM CP437 codepage for their ASCII/ANSI art — box-drawing lines,
                shade blocks and extended punctuation only align in a monospace terminal. The pane above scrolls
                horizontally instead of wrapping, exactly like a 80×N DOS console. Toggle the color scheme
                (phosphor green, amber or plain), font size, CRT scanline overlay, background (black / dark / paper)
                and charset decoding from the toolbar.
                {arrayBuffer === null ? " Note: file exceeded the load cap — showing the first 64 KB." : ""}
              </p>
            </SectionCard>
          </div>
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Terminal className="h-3.5 w-3.5" />
        <span className="truncate">
          {formatNum(lines.length)} lines · {charset.toUpperCase()} · {formatNum(boxChars)} box chars · {fileName}
        </span>
        {pngNote ? (
          <span className="ml-auto shrink-0 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300">{pngNote}</span>
        ) : null}
      </div>
    </div>
  );
}
