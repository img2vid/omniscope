"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Segmented,
  SectionCard, InfoGrid, Field, Chip, Copyable,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";
import {
  ZoomIn, ZoomOut, RotateCw, FlipHorizontal, FlipVertical, Maximize, Download, Pipette,
  Sun, Contrast, Palette, Info, Aperture,
} from "lucide-react";

interface LoadedBitmap { url: string; width: number; height: number; source: string; alpha: boolean; }

export default function ImageViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [img, setImg] = React.useState<LoadedBitmap | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [flipH, setFlipH] = React.useState(false);
  const [flipV, setFlipV] = React.useState(false);
  const [mode, setMode] = React.useState<"fit" | "1:1" | "free">("fit");
  const [panel, setPanel] = React.useState<"info" | "exif" | "palette">("info");
  const [exif, setExif] = React.useState<Record<string, unknown> | null | "pending">(null);
  const [palette, setPalette] = React.useState<string[] | null>(null);
  const [filters, setFilters] = React.useState({ brightness: 100, contrast: 100, saturate: 100, grayscale: 0, invert: 0 });
  const [showFilters, setShowFilters] = React.useState(false);
  const [pixel, setPixel] = React.useState<{ x: number; y: number; hex: string; rgb: string } | null>(null);
  const [pickMode, setPickMode] = React.useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const elRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ x: number; y: number; scrollL: number; scrollT: number } | null>(null);

  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const isHeic = ext === "heic" || ext === "heif" || (detected.record?.key === "heic");

  // ---- decode ----
  React.useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      // ordered decoder chain: native → TIFF → PSD → HEIC
      const attempts: { name: string; run: () => Promise<LoadedBitmap> }[] = [
        {
          name: "browser decoder",
          run: async () => {
            const url = URL.createObjectURL(file);
            createdUrl = url;
            const bmp = await createImageBitmap(file).catch(() => null);
            const probe = new Image();
            await new Promise<void>((res, rej) => {
              probe.onload = () => res();
              probe.onerror = () => rej(new Error("native decode failed"));
              probe.src = url;
            });
            return {
              url,
              width: bmp?.width ?? probe.naturalWidth,
              height: bmp?.height ?? probe.naturalHeight,
              source: "browser decoder",
              alpha: true,
            };
          },
        },
        {
          name: "UTIF (TIFF)",
          run: async () => {
            const UTIF = (await import("utif")).default;
            if (!arrayBuffer) throw new Error("no bytes");
            const ifds = UTIF.decode(arrayBuffer);
            UTIF.decodeImage(arrayBuffer, ifds[0], ifds);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const w = ifds[0].width as number;
            const h = ifds[0].height as number;
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d")!;
            const idata = ctx.createImageData(w, h);
            idata.data.set(rgba);
            ctx.putImageData(idata, 0, 0);
            return { url: c.toDataURL("image/png"), width: w, height: h, source: "UTIF (TIFF)", alpha: true };
          },
        },
        {
          name: "ag-psd",
          run: async () => {
            if (ext !== "psd" && ext !== "psb") throw new Error("not a PSD");
            const agpsd = await import("ag-psd");
            if (!arrayBuffer) throw new Error("no bytes");
            const psd = agpsd.readPsd(new Uint8Array(arrayBuffer));
            const c = document.createElement("canvas");
            c.width = psd.width;
            c.height = psd.height;
            const ctx = c.getContext("2d")!;
            if (psd.canvas) ctx.drawImage(psd.canvas, 0, 0);
            else if (psd.imageData) {
              const id = ctx.createImageData(psd.imageData.width, psd.imageData.height);
              id.data.set(psd.imageData.data);
              ctx.putImageData(id, 0, 0);
            }
            return {
              url: c.toDataURL("image/png"),
              width: psd.width,
              height: psd.height,
              source: `ag-psd · ${psd.children?.length ?? 0} layer(s)`,
              alpha: true,
            };
          },
        },
        {
          name: "heic2any (libheif)",
          run: async () => {
            if (!isHeic) throw new Error("not HEIC");
            const heic2any = (await import("heic2any")).default;
            const blob = await heic2any({ blob: file, toType: "image/png" });
            const out = Array.isArray(blob) ? blob[0] : blob;
            const outUrl = URL.createObjectURL(out);
            const probe = new Image();
            await new Promise<void>((res, rej) => {
              probe.onload = () => res();
              probe.onerror = () => rej(new Error("heic decode failed"));
              probe.src = outUrl;
            });
            return { url: outUrl, width: probe.naturalWidth, height: probe.naturalHeight, source: "heic2any (libheif)", alpha: true };
          },
        },
      ];
      for (const attempt of attempts) {
        try {
          const result = await attempt.run();
          if (!cancelled) setImg(result);
          return;
        } catch {
          continue;
        }
      }
      if (!cancelled) setErr("This image can't be decoded by any engine — switch to the Hex view for raw bytes.");
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [file, arrayBuffer, ext, isHeic]);

  // ---- exif ----
  React.useEffect(() => {
    if (!img || panel !== "exif" || exif !== null) return;
    setExif("pending");
    (async () => {
      try {
        const exifr = (await import("exifr")).default;
        const out = await exifr.parse(file, { tiff: true, ifd0: {}, exif: {}, gps: {}, translateValues: true, reviveValues: true });
        setExif(out ?? {});
      } catch {
        setExif({});
      }
    })();
  }, [panel, img, file, exif]);

  // ---- palette ----
  React.useEffect(() => {
    if (!img || panel !== "palette" || palette) return;
    const probe = new Image();
    probe.onload = () => {
      const c = document.createElement("canvas");
      const w = 96, h = Math.max(1, Math.round(96 * (img.height / img.width)));
      c.width = w; c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(probe, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      // quantize to 4 bits/channel buckets
      const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const key = `${data[i] >> 5}_${data[i + 1] >> 5}_${data[i + 2] >> 5}`;
        const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
        b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n++;
        buckets.set(key, b);
      }
      const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 18).map((b) => {
        const r = Math.round(b.r / b.n), g = Math.round(b.g / b.n), bl = Math.round(b.b / b.n);
        return "#" + [r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("");
      });
      setPalette(top);
    };
    probe.src = img.url;
  }, [img, panel, palette]);

  // ---- wheel zoom ----
  function onWheel(e: React.WheelEvent) {
    if (mode === "fit") return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((z) => Math.min(40, Math.max(0.05, z * factor)));
    setMode("free");
  }

  // ---- pixel picking ----
  function onCanvasClick(e: React.MouseEvent) {
    if (!pickMode || !img) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * img.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * img.height);
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d")!;
    const probe = new Image();
    probe.onload = () => {
      ctx.drawImage(probe, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      setPixel({
        x, y,
        hex: "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""),
        rgb: `rgb(${d[0]}, ${d[1]}, ${d[2]})`,
      });
    };
    probe.src = img.url;
  }

  const fitScale = img && elRef.current
    ? Math.min(elRef.current.clientWidth / img.width, elRef.current.clientHeight / img.height)
    : 1;
  const scale = mode === "fit" ? fitScale : mode === "1:1" ? 1 : zoom;
  const transform = `scale(${scale}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;
  const cssFilter = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) grayscale(${filters.grayscale}%) invert(${filters.invert}%)`;

  if (err) return <ErrorCard title="Image decode failed" message={err} hint="The file was still identified — switch to Hex or Text view for raw contents." />;
  if (!img) return <LoadingState label="Decoding image…" />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <ToolButton label="Fit" active={mode === "fit"} onClick={() => setMode("fit")}><Maximize className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="1:1" active={mode === "1:1"} onClick={() => setMode("1:1")}>1:1</ToolButton>
              <ToolButton onClick={() => { setZoom((z) => Math.max(0.05, z / 1.25)); setMode("free"); }}><ZoomOut className="h-3.5 w-3.5" /></ToolButton>
              <span className="w-14 text-center font-mono text-[11px] text-zinc-400">{Math.round(scale * 100)}%</span>
              <ToolButton onClick={() => { setZoom((z) => Math.min(40, z * 1.25)); setMode("free"); }}><ZoomIn className="h-3.5 w-3.5" /></ToolButton>
              <ToolbarDivider />
              <ToolButton onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton active={flipH} onClick={() => setFlipH((v) => !v)}><FlipHorizontal className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton active={flipV} onClick={() => setFlipV((v) => !v)}><FlipVertical className="h-3.5 w-3.5" /></ToolButton>
              <ToolbarDivider />
              <ToolButton active={showFilters} onClick={() => setShowFilters((v) => !v)} title="Adjustments"><Sun className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton active={pickMode} onClick={() => setPickMode((v) => !v)} title="Pixel picker"><Pipette className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
          right={
            <>
              {pixel ? <Chip tone="emerald" className="font-mono">{pixel.hex} @ {pixel.x},{pixel.y}</Chip> : null}
              <ToolButton label="PNG" onClick={() => {
                const c = document.createElement("canvas");
                c.width = img.width; c.height = img.height;
                const ctx = c.getContext("2d")!;
                ctx.filter = cssFilter;
                const probe = new Image();
                probe.onload = () => { ctx.drawImage(probe, 0, 0); c.toBlob((b) => b && downloadBlob(b, fileName.replace(/\.\w+$/, "") + ".png", "image/png")); };
                probe.src = img.url;
              }}><Download className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
        />
        {showFilters ? (
          <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 border-b border-zinc-800 bg-zinc-900/70 px-4 py-2.5 md:grid-cols-5">
            {([["brightness", "Brightness", 0, 300, Sun], ["contrast", "Contrast", 0, 300, Contrast], ["saturate", "Saturation", 0, 300, Aperture], ["grayscale", "Grayscale", 0, 100, Palette], ["invert", "Invert", 0, 100, FlipVertical]] as const).map(([key, label, min, max, Icon]) => (
              <label key={key} className="flex items-center gap-2 text-[11px] text-zinc-400">
                <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span className="w-16 shrink-0">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={filters[key]}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: Number(e.target.value) }))}
                  className="min-w-0 flex-1 accent-emerald-500"
                />
                <span className="w-9 text-right font-mono text-zinc-500">{filters[key]}</span>
              </label>
            ))}
          </div>
        ) : null}
        <ViewerBody className="relative flex items-center justify-center overflow-auto p-4">
          <div
            ref={elRef}
            className="relative flex items-center justify-center"
            style={{ minWidth: "100%", minHeight: "100%" }}
          >
            <img
              src={img.url}
              alt={fileName}
              onWheel={onWheel}
              onClick={onCanvasClick}
              draggable={false}
              style={{ transform, filter: cssFilter, imageRendering: scale > 3 ? "pixelated" : "auto" }}
              className={cn("select-none shadow-2xl shadow-black/60 ring-1 ring-zinc-800", pickMode && "cursor-crosshair", mode !== "fit" && "cursor-grab")}
              onMouseDown={(e) => {
                if (mode === "fit") return;
                const parent = (e.target as HTMLElement).parentElement!.parentElement!;
                dragRef.current = { x: e.clientX, y: e.clientY, scrollL: parent.scrollLeft, scrollT: parent.scrollTop };
                (e.target as HTMLElement).style.cursor = "grabbing";
              }}
              onMouseMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                const parent = (e.target as HTMLElement).parentElement!.parentElement!;
                parent.scrollLeft = d.scrollL - (e.clientX - d.x);
                parent.scrollTop = d.scrollT - (e.clientY - d.y);
              }}
              onMouseUp={(e) => {
                dragRef.current = null;
                (e.target as HTMLElement).style.cursor = "";
              }}
              onMouseLeave={() => { dragRef.current = null; }}
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden />
          </div>
        </ViewerBody>
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
          <Chip tone="emerald">{img.width} × {img.height}</Chip>
          <Chip>{(img.width / img.height).toFixed(3)} : 1</Chip>
          <Chip>{formatBytes(file.size)}</Chip>
          <span className="ml-auto hidden sm:inline">{img.source} · scroll to zoom · drag to pan</span>
        </div>
      </div>

      {/* right panel */}
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950/40 p-3 scrollbar-thin lg:flex">
        <Segmented
          value={panel}
          onChange={setPanel}
          options={[
            { value: "info", label: "Info" },
            { value: "exif", label: "EXIF" },
            { value: "palette", label: "Palette" },
          ]}
          className="w-full"
        />
        {panel === "info" ? (
          <SectionCard title="Image properties" icon={<Info className="h-3.5 w-3.5" />}>
            <InfoGrid>
              <Field label="Dimensions" mono>{img.width} × {img.height} px</Field>
              <Field label="Megapixels" mono>{((img.width * img.height) / 1e6).toFixed(2)} MP</Field>
              <Field label="Aspect">{(img.width / img.height).toFixed(4)}</Field>
              <Field label="File size">{formatBytes(file.size)}</Field>
              <Field label="Decoder">{img.source}</Field>
              <Field label="Format">{detected.name}</Field>
              <Field label="Bytes/px" mono>{(file.size / (img.width * img.height || 1)).toFixed(1)}</Field>
            </InfoGrid>
          </SectionCard>
        ) : null}
        {panel === "exif" ? (
          <SectionCard title="EXIF metadata" icon={<Aperture className="h-3.5 w-3.5" />}>
            {exif === "pending" ? (
              <LoadingState label="Parsing EXIF…" />
            ) : exif ? (
              Object.keys(exif as Record<string, unknown>).length ? (
                <InfoGrid>
                  {Object.entries(exif as Record<string, unknown>).slice(0, 40).map(([k, v]) => (
                    <Field key={k} label={k} mono>{String(v)}</Field>
                  ))}
                </InfoGrid>
              ) : (
                <div className="text-xs text-zinc-500">No EXIF metadata found in this image.</div>
              )
            ) : null}
          </SectionCard>
        ) : null}
        {panel === "palette" ? (
          <SectionCard title="Dominant colors" icon={<Palette className="h-3.5 w-3.5" />}>
            {palette ? (
              <div className="grid grid-cols-6 gap-1.5">
                {palette.map((c) => (
                  <button
                    key={c}
                    onClick={() => navigator.clipboard?.writeText(c)}
                    title={`Copy ${c}`}
                    className="group relative aspect-square rounded ring-1 ring-zinc-700 transition-transform hover:z-10 hover:scale-110"
                    style={{ background: c }}
                  >
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/60 font-mono text-[9px] text-white group-hover:flex">{c}</span>
                  </button>
                ))}
              </div>
            ) : (
              <LoadingState label="Extracting palette…" />
            )}
            {pixel ? (
              <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-2">
                <div className="h-8 w-8 rounded ring-1 ring-zinc-700" style={{ background: pixel.hex }} />
                <div className="font-mono text-[11px] text-zinc-300">
                  <Copyable value={pixel.hex} />
                  <div className="text-zinc-500">{pixel.rgb} · ({pixel.x}, {pixel.y})</div>
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}
      </aside>
    </div>
  );
}
