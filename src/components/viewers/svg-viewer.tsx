"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, LoadingState, Segmented, Chip, SectionCard, InfoGrid, Field,
} from "./viewer-ui";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Maximize, Code2, Shapes, Download } from "lucide-react";

export default function SvgViewer({ file, arrayBuffer, head, fileName }: ViewerProps) {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [source, setSource] = React.useState<string>("");
  const [mode, setMode] = React.useState<"render" | "code">("render");
  const [zoom, setZoom] = React.useState(1);
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const [stats, setStats] = React.useState<{ elements: number; paths: number; viewBox: string | null } | null>(null);

  React.useEffect(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4 * 1024 * 1024));
    setSource(text);
    try {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg && svg.nodeName.toLowerCase() === "svg") {
        setStats({
          elements: svg.querySelectorAll("*").length,
          paths: svg.querySelectorAll("path").length,
          viewBox: svg.getAttribute("viewBox"),
        });
        const w = svg.getAttribute("width");
        const h = svg.getAttribute("height");
        if (w && h) setDims({ w: parseFloat(w), h: parseFloat(h) });
      }
    } catch { /* ignore */ }
  }, [arrayBuffer, head]);

  const MAX = 40;
  const containerRef = React.useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <Chip tone="emerald">SVG</Chip>
              {dims ? <Chip>{dims.w}×{dims.h}</Chip> : null}
              {stats?.viewBox ? <Chip tone="teal">viewBox {stats.viewBox}</Chip> : null}
            </>
          }
          right={
            <>
              <ToolButton label="Fit" onClick={() => setZoom(1)}><Maximize className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton onClick={() => setZoom((z) => Math.max(0.05, z / 1.25))}><ZoomOut className="h-3.5 w-3.5" /></ToolButton>
              <span className="w-12 text-center font-mono text-[11px] text-zinc-400">{Math.round(zoom * 100)}%</span>
              <ToolButton onClick={() => setZoom((z) => Math.min(64, z * 1.25))}><ZoomIn className="h-3.5 w-3.5" /></ToolButton>
              <ToolbarDivider />
              <Segmented value={mode} onChange={setMode} options={[{ value: "render", label: "Render" }, { value: "code", label: "XML" }]} />
              <ToolButton label="PNG" onClick={() => {
                const probe = new Image();
                probe.onload = () => {
                  const scale = Math.min(4, 2048 / (probe.naturalWidth || 512));
                  const c = document.createElement("canvas");
                  c.width = (probe.naturalWidth || 512) * scale;
                  c.height = (probe.naturalHeight || 512) * scale;
                  c.getContext("2d")!.drawImage(probe, 0, 0, c.width, c.height);
                  c.toBlob((b) => {
                    if (!b) return;
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(b);
                    a.download = fileName.replace(/\.svg$/i, "") + ".png";
                    a.click();
                  });
                };
                probe.src = url;
              }}><Download className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
        />
        <ViewerBody className="flex items-center justify-center p-6">
          {mode === "render" ? (
            <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-auto">
              {}
              <img
                src={url}
                alt={fileName}
                style={{
                  transform: `scale(${zoom})`,
                  maxWidth: zoom === 1 ? "100%" : undefined,
                  maxHeight: zoom === 1 ? "100%" : undefined,
                }}
                className={cn("select-none", zoom > 3 && "[image-rendering:pixelated]")}
                draggable={false}
              />
            </div>
          ) : (
            <pre className="max-w-5xl whitespace-pre-wrap break-words p-6 font-mono text-[12px] leading-5 text-zinc-300">{source}</pre>
          )}
        </ViewerBody>
      </div>
      <aside className="hidden w-64 shrink-0 flex-col gap-3 border-l border-zinc-800 bg-zinc-950/40 p-3 scrollbar-thin lg:flex">
        <SectionCard title="Vector stats" icon={<Shapes className="h-3.5 w-3.5" />}>
          <InfoGrid>
            <Field label="Elements" mono>{stats?.elements ?? "—"}</Field>
            <Field label="Paths" mono>{stats?.paths ?? "—"}</Field>
            <Field label="viewBox">{stats?.viewBox ?? "—"}</Field>
            <Field label="Size">{new Blob([source]).size} B</Field>
          </InfoGrid>
        </SectionCard>
        <SectionCard title="Source" icon={<Code2 className="h-3.5 w-3.5" />}>
          <div className="text-[11px] leading-relaxed text-zinc-500">
            Scalable Vector Graphics render natively at any zoom without quality loss. Export to PNG rasterizes at up to 2048 px.
          </div>
        </SectionCard>
      </aside>
    </div>
  );
}
