"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, LoadingState, SectionCard, InfoGrid, Field, Chip, Segmented,
} from "./viewer-ui";
import { computeSpectrogram, computeWaveform, parseMediaMeta, type MediaMeta } from "@/lib/media-meta";
import { cn, formatBytes, formatDuration, accentCss, observeAccent } from "@/lib/utils";
import {
  Play, Pause, Volume2, VolumeX, AudioWaveform, Activity, Disc3, Download, Gauge,
} from "lucide-react";

export default function AudioViewer({ file, head, detected, fileName }: ViewerProps) {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [rate, setRate] = React.useState(1);
  const [view, setView] = React.useState<"wave" | "spec">("wave");
  const [meta, setMeta] = React.useState<MediaMeta | null>(null);
  const [pcm, setPcm] = React.useState<{ channel: Float32Array; sr: number } | null>(null);
  const [decodeErr, setDecodeErr] = React.useState<string | null>(null);
  const [loadingPcm, setLoadingPcm] = React.useState(true);
  const waveCanvas = React.useRef<HTMLCanvasElement>(null);
  const specCanvas = React.useRef<HTMLCanvasElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);

  // container metadata from head bytes
  React.useEffect(() => {
    setMeta(parseMediaMeta(head, fileName, file.size));
  }, [head, fileName, file.size]);

  // decode PCM for visualization
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AC();
        const buf = await file.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        if (cancelled) { ctx.close(); return; }
        setPcm({ channel: audio.getChannelData(0), sr: audio.sampleRate });
        setDuration(audio.duration);
        ctx.close();
      } catch (e) {
        if (!cancelled) setDecodeErr(e instanceof Error ? e.message : "PCM decode failed (codec unsupported by browser)");
      } finally {
        if (!cancelled) setLoadingPcm(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  // draw waveform (redraws on resize via ResizeObserver)
  React.useEffect(() => {
    if (!pcm || view !== "wave") return;
    const pcmData = pcm;
    const c = waveCanvas.current;
    if (!c) return;

    function draw() {
      const canvas = waveCanvas.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (W < 2 || H < 2) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const { mins, maxs } = computeWaveform(pcmData.channel, 1400);
      const mid = H / 2;
      const scale = mid - 8;
      // center reference line
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(0, mid - 0.5, W, 1);
      // envelope bars: max goes UP (smaller y), min goes DOWN (larger y)
      const barW = Math.max(1, W / mins.length);
      for (let x = 0; x < mins.length; x++) {
        const px = (x / mins.length) * W;
        const top = mid - Math.max(0, maxs[x]) * scale;
        const bot = mid - Math.min(0, mins[x]) * scale;
        const h = Math.max(1.5, bot - top);
        const grad = ctx.createLinearGradient(0, mid - scale, 0, mid + scale);
        grad.addColorStop(0, accentCss(300, 0.95, "#34d399"));
        grad.addColorStop(0.5, accentCss(500, 0.55, "#10b981"));
        grad.addColorStop(1, accentCss(300, 0.95, "#34d399"));
        ctx.fillStyle = grad;
        ctx.fillRect(px, top, barW, h);
      }
    }

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    // live accent: redraw when the palette flips (html[data-accent] mutation)
    const stopAccentWatch = observeAccent(() => draw());
    return () => { ro.disconnect(); stopAccentWatch(); };
  }, [pcm, view]);

  // draw spectrogram
  React.useEffect(() => {
    if (!pcm || view !== "spec") return;
    const pcmData = pcm;
    const c = specCanvas.current;
    if (!c) return;

    function draw() {
      const canvas = specCanvas.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (W < 2 || H < 2) return;
      const cols = 900, bins = 256;
      const spec = computeSpectrogram(pcmData.channel, cols, bins * 2);
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d")!;
      const img = ctx.createImageData(W * dpr, H * dpr);
      const pw = W * dpr, ph = H * dpr;
      // vertical axis = log frequency
      for (let y = 0; y < ph; y++) {
        const frac = 1 - y / ph;
        const bin = Math.round(Math.pow(frac, 2) * (bins - 1));
        for (let x = 0; x < pw; x++) {
          const col = Math.min(cols - 1, Math.round((x / pw) * cols));
          const v = spec[col * bins + Math.max(0, bin)] ?? 0;
          const i = (y * pw + x) * 4;
          // magma-like colormap
          img.data[i] = Math.min(255, 40 + v * 255 * 1.1);
          img.data[i + 1] = Math.min(255, Math.pow(v, 1.6) * 220);
          img.data[i + 2] = Math.min(255, Math.pow(v, 2.4) * 255 + 30);
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [pcm, view]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); } else { a.pause(); }
  }

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  }

  const progressPct = duration ? (time / duration) * 100 : 0;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <ViewerToolbar
          left={
            <>
              <Chip tone="emerald">{detected.name}</Chip>
              {meta?.codec ? <Chip tone="teal">{meta.codec}</Chip> : null}
            </>
          }
          right={
            <>
              <ToolButton label="Save" onClick={() => {
                const a = document.createElement("a");
                a.href = url;
                a.download = fileName;
                a.click();
              }}><Download className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
        />
        {/* transport */}
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 transition-all hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div
                role="slider"
                aria-label="Seek"
                aria-valuenow={Math.round(progressPct)}
                tabIndex={0}
                onClick={seekFromEvent}
                onKeyDown={(e) => {
                  const a = audioRef.current;
                  if (!a) return;
                  if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5);
                  if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + 5);
                }}
                className="group relative h-8 cursor-pointer select-none"
              >
                <div className="absolute inset-x-0 top-3.5 h-1.5 rounded-full bg-zinc-800" />
                <div ref={progressRef} className="absolute left-0 top-3.5 h-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400" style={{ width: `${progressPct}%` }} />
                <div
                  className="absolute top-2 h-4 w-4 rounded-full border-2 border-emerald-400 bg-zinc-950 opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{ left: `calc(${progressPct}% - 8px)` }}
                />
              </div>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-zinc-400">
              {formatDuration(time)} / {formatDuration(duration || (meta?.durationSec ?? 0))}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setMuted((m) => !m); if (audioRef.current) audioRef.current.muted = !muted; }}
                className="flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:text-zinc-200"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setMuted(v === 0);
                  if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = v === 0; }
                }}
                className="w-16 accent-emerald-500"
                aria-label="Volume"
              />
            </div>
            <div className="hidden items-center gap-1 md:flex">
              <Gauge className="h-3.5 w-3.5 text-zinc-500" />
              {[0.5, 1, 1.5, 2].map((r) => (
                <button
                  key={r}
                  onClick={() => { setRate(r); if (audioRef.current) audioRef.current.playbackRate = r; }}
                  className={cn("rounded px-1.5 py-0.5 text-[10px]", rate === r ? "bg-emerald-900/60 text-emerald-300" : "text-zinc-500 hover:text-zinc-300")}
                >
                  {r}×
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* visualization */}
        <ViewerBody className="flex flex-col p-4">
          <div className="mb-2 flex items-center justify-between">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "wave", label: "Waveform" },
                { value: "spec", label: "Spectrogram" },
              ]}
            />
            {pcm ? <span className="font-mono text-[10px] text-zinc-600">{pcm.sr} Hz · {formatBytes(file.size)}</span> : null}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            {view === "wave" && pcm && !loadingPcm && !decodeErr && duration > 0 ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-10 w-[2px] bg-amber-400/90 shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                style={{ left: `${progressPct}%` }}
              />
            ) : null}
            {loadingPcm ? (
              <LoadingState label="Decoding PCM…" />
            ) : decodeErr ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-xs text-zinc-500">
                <div>
                  <AudioWaveform className="mx-auto mb-2 h-8 w-8 text-zinc-700" />
                  Visual analysis unavailable: {decodeErr}
                  <div className="mt-1 text-zinc-600">Playback may still work. See the Info panel for parsed container metadata.</div>
                </div>
              </div>
            ) : view === "wave" ? (
              <canvas ref={waveCanvas} className="h-full w-full" />
            ) : (
              <canvas ref={specCanvas} className="h-full w-full" />
            )}
            {view === "spec" && !loadingPcm && !decodeErr ? (
              <div className="pointer-events-none absolute inset-y-0 left-1 flex flex-col justify-between py-1 font-mono text-[8px] text-zinc-500">
                <span>{pcm ? `${(pcm.sr / 2000).toFixed(1)}k` : ""}</span>
                <span>{pcm ? `${(pcm.sr / 8000).toFixed(1)}k` : ""}</span>
                <span>{pcm ? `${(pcm.sr / 32000).toFixed(1)}k` : ""}</span>
                <span>0</span>
              </div>
            ) : null}
          </div>
        </ViewerBody>
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime((e.target as HTMLAudioElement).currentTime)}
          onLoadedMetadata={(e) => {
            const d = (e.target as HTMLAudioElement).duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
          preload="metadata"
          className="hidden"
        />
      </div>
      {/* info sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800 bg-zinc-950/40 p-3 scrollbar-thin lg:flex">
        {meta?.picture ? (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            { }
            <img src={meta.picture.url} alt="Cover art" className="w-full" />
          </div>
        ) : null}
        <SectionCard title="Stream properties" icon={<Activity className="h-3.5 w-3.5" />}>
          <InfoGrid>
            <Field label="Container">{meta?.container ?? detected.name}</Field>
            <Field label="Codec">{meta?.codec ?? "—"}</Field>
            <Field label="Sample rate" mono>{meta?.sampleRate ? `${meta.sampleRate} Hz` : "—"}</Field>
            <Field label="Channels">{meta?.channels === 1 ? "Mono" : meta?.channels === 2 ? "Stereo" : meta?.channels ? `${meta.channels} ch` : "—"}</Field>
            <Field label="Bits/sample" mono>{meta?.bitsPerSample ?? "—"}</Field>
            <Field label="Bitrate" mono>{meta?.bitrateKbps ? `${meta.bitrateKbps} kbps` : "—"}</Field>
            <Field label="Duration">{formatDuration(duration || meta?.durationSec || 0)}</Field>
            <Field label="Size">{formatBytes(file.size)}</Field>
          </InfoGrid>
        </SectionCard>
        <SectionCard title="Tags" icon={<Disc3 className="h-3.5 w-3.5" />}>
          {meta?.tags && Object.keys(meta.tags).length ? (
            <InfoGrid>
              {Object.entries(meta.tags).map(([k, v]) => (
                <Field key={k} label={k}>{v}</Field>
              ))}
            </InfoGrid>
          ) : (
            <div className="flex items-center gap-2.5 rounded-md border border-dashed border-zinc-800 px-3 py-3 text-[11px] text-zinc-600">
              <Disc3 className="h-4 w-4 shrink-0 text-zinc-700" />
              <span>
                <span className="text-zinc-500">No embedded tags</span> — ID3/Vorbis/FLAC metadata would appear here.
              </span>
            </div>
          )}
        </SectionCard>
      </aside>
    </div>
  );
}
