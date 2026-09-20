"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, SectionCard, InfoGrid, Field, Chip,
} from "./viewer-ui";
import { parseMediaMeta, type MediaMeta } from "@/lib/media-meta";
import { formatBytes, formatDuration } from "@/lib/utils";
import { Camera, Download, Film, MonitorPlay, Maximize2, SkipBack, SkipForward } from "lucide-react";

export default function VideoViewer({ file, head, detected, fileName }: ViewerProps) {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [meta, setMeta] = React.useState<MediaMeta | null>(null);
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [time, setTime] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMeta(parseMediaMeta(head, fileName, file.size));
  }, [head, fileName, file.size]);

  function captureFrame() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = fileName.replace(/\.\w+$/, "") + `-frame-${Math.round(v.currentTime * 1000)}ms.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }, "image/png");
  }

  function step(frames: number) {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + frames / 30));
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <Chip tone="emerald">{detected.name}</Chip>
              {meta?.codec ? <Chip tone="teal">{meta.codec}</Chip> : null}
              {dims ? <Chip>{dims.w}×{dims.h}</Chip> : null}
            </>
          }
          right={
            <>
              <ToolButton label="−1f" onClick={() => step(-1)} title="Back one frame"><SkipBack className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="+1f" onClick={() => step(1)} title="Forward one frame"><SkipForward className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="Snapshot" onClick={captureFrame}><Camera className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="Fullscreen" onClick={() => videoRef.current?.requestFullscreen?.().catch(() => {})}><Maximize2 className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="Save" onClick={() => {
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
              }}><Download className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
        />
        <ViewerBody className="flex items-center justify-center bg-black/40 p-2">
          <video
            ref={videoRef}
            src={url}
            controls
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.target as HTMLVideoElement;
              setDims({ w: v.videoWidth, h: v.videoHeight });
              if (Number.isFinite(v.duration)) setDuration(v.duration);
            }}
            onTimeUpdate={(e) => setTime((e.target as HTMLVideoElement).currentTime)}
            onError={() => setErr("Browser cannot decode this video codec — metadata below was parsed from the container.")}
            className="max-h-full max-w-full rounded-lg shadow-2xl shadow-black"
          />
        </ViewerBody>
        {err ? (
          <div className="shrink-0 border-t border-amber-900/50 bg-amber-950/20 px-3 py-2 text-center text-[11px] text-amber-300">{err}</div>
        ) : null}
        <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 font-mono text-[11px] text-zinc-500">
          <MonitorPlay className="h-3.5 w-3.5" />
          <span>{formatDuration(time)} / {formatDuration(duration || meta?.durationSec || 0)}</span>
          {dims ? <span className="ml-2">{dims.w} × {dims.h} ({(dims.w / dims.h).toFixed(2)}:1)</span> : null}
          <span className="ml-auto">{formatBytes(file.size)}</span>
        </div>
      </div>
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950/40 p-3 scrollbar-thin lg:flex">
        <SectionCard title="Container info" icon={<Film className="h-3.5 w-3.5" />}>
          <InfoGrid>
            <Field label="Container">{meta?.container ?? detected.name}</Field>
            <Field label="Video codec">{meta?.codec ?? "—"}</Field>
            <Field label="Resolution" mono>{meta?.video ? `${meta.video.width} × ${meta.video.height}` : dims ? `${dims.w} × ${dims.h}` : "—"}</Field>
            <Field label="Frame rate" mono>{meta?.video?.fps ? `${meta.video.fps} fps` : "—"}</Field>
            <Field label="Duration">{formatDuration(duration || meta?.durationSec || 0)}</Field>
            <Field label="Audio codec">{meta?.kind === "audio" ? "—" : meta?.channels ? `${meta.channels} ch @ ${meta.sampleRate ?? "?"} Hz` : "—"}</Field>
            <Field label="Bitrate" mono>{duration ? `${Math.round((file.size * 8) / duration / 1000)} kbps` : "—"}</Field>
            <Field label="Size">{formatBytes(file.size)}</Field>
          </InfoGrid>
        </SectionCard>
        <SectionCard title="Tags" icon={<Film className="h-3.5 w-3.5" />}>
          {meta?.tags && Object.keys(meta.tags).length ? (
            <InfoGrid>
              {Object.entries(meta.tags).map(([k, v]) => (
                <Field key={k} label={k}>{v}</Field>
              ))}
            </InfoGrid>
          ) : (
            <div className="text-xs text-zinc-500">No container tags.</div>
          )}
        </SectionCard>
      </aside>
    </div>
  );
}
