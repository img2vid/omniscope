"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ErrorCard, LoadingState, Chip, SectionCard, InfoGrid, Field, EmptyHint } from "./viewer-ui";
import { decodeWith, downloadBlob, formatDuration } from "@/lib/utils";
import { Captions, Clock, Download, FileText, Search, Tags, Type } from "lucide-react";

/* ------------------------------ cue model ------------------------------ */

export interface Cue {
  index: number;
  start: number; // seconds
  end: number; // seconds
  text: string;
  style?: string;
  speaker?: string;
}

export interface AssStyle {
  name: string;
  font: string;
  size: string;
  primary?: string;
}

export interface SubtitleDoc {
  kind: "srt" | "vtt" | "ass" | "lrc";
  cues: Cue[];
  duration: number;
  styleCount: number;
  styles: AssStyle[];
  tags: Record<string, string>;
  metaTitle: string;
}

/* ------------------------------ helpers ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanCueText(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

/** timestamp like [hh:]mm:ss[.,]mmm (VTT/SRT) */
function parseTimeStamp(s: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0;
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  const core = `${h > 0 ? `${String(h).padStart(2, "0")}:` : ""}${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${core}.${String(ms).padStart(3, "0")}`;
}

function toSrtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toVttTime(sec: number): string {
  return toSrtTime(sec).replace(",", ".");
}

/* ------------------------------ parsers ------------------------------ */

const TIME_LINE = /(\d{1,2}:\d{1,2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/;

function parseSrtVtt(text: string, kind: "srt" | "vtt"): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    if (kind === "vtt") {
      const first = lines[0].trim();
      if (/^WEBVTT/i.test(first) && lines.length === 1) continue;
      if (/^(NOTE|STYLE|REGION)\b/i.test(first)) continue;
    }
    let timeIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 4); i++) {
      if (TIME_LINE.test(lines[i])) {
        timeIdx = i;
        break;
      }
    }
    if (timeIdx === -1) continue;
    const m = TIME_LINE.exec(lines[timeIdx]);
    if (!m) continue;
    const start = parseTimeStamp(m[1]);
    const end = parseTimeStamp(m[2]);
    if (start === null || end === null) continue;
    const body = lines.slice(timeIdx + 1).join("\n").trim();
    if (!body) continue;
    cues.push({
      index: cues.length,
      start,
      end: Math.max(end, start + 0.001),
      text: cleanCueText(body),
    });
  }
  return cues;
}

function parseAss(text: string): { cues: Cue[]; styles: AssStyle[]; tags: Record<string, string> } {
  const cues: Cue[] = [];
  const styles: AssStyle[] = [];
  const tags: Record<string, string> = {};
  const lines = text.split(/\r\n|\r|\n/);
  let section = "";
  let styleFormat: string[] = [];
  let eventFormat: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      section = line.toLowerCase();
      continue;
    }
    if (/^\uFEFF?\[/.test(rawLine)) {
      section = rawLine.trim().toLowerCase();
      continue;
    }
    if (section.startsWith("[script info")) {
      const kv = /^([^:]+?):\s*(.*)$/.exec(line);
      if (kv) tags[kv[1].trim().toLowerCase()] = kv[2].trim();
      continue;
    }
    if (section.includes("style")) {
      const fm = /^Format\s*:\s*(.*)$/i.exec(line);
      if (fm) {
        styleFormat = fm[1].split(",").map((s) => s.trim());
        continue;
      }
      const sm = /^Style\s*:\s*(.*)$/i.exec(line);
      if (sm) {
        const vals = sm[1].split(",").map((s) => s.trim());
        const get = (name: string): string => {
          const idx = styleFormat.indexOf(name);
          return idx >= 0 && idx < vals.length ? vals[idx] : "";
        };
        styles.push({
          name: get("Name") || vals[0] || `Style ${styles.length + 1}`,
          font: get("Fontname") || "—",
          size: get("Fontsize") || "—",
          primary: get("PrimaryColour"),
        });
      }
      continue;
    }
    if (section.includes("event")) {
      const fm = /^Format\s*:\s*(.*)$/i.exec(line);
      if (fm) {
        eventFormat = fm[1].split(",").map((s) => s.trim());
        continue;
      }
      const dm = /^Dialogue\s*:\s*(.*)$/i.exec(line);
      if (!dm) continue;
      const fields = eventFormat.length ? eventFormat : ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"];
      const parts = dm[1].split(",", fields.length - 1);
      const get = (name: string): string => {
        const idx = fields.indexOf(name);
        return idx >= 0 && idx < parts.length ? parts[idx].trim() : "";
      };
      const start = parseAssTime(get("Start"));
      const end = parseAssTime(get("End"));
      if (start === null || end === null) continue;
      let body = parts[fields.length - 1] ?? "";
      body = body
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\[Nn]/g, "\n")
        .replace(/\\h/g, " ")
        .trim();
      if (!body) continue;
      cues.push({
        index: cues.length,
        start,
        end: Math.max(end, start + 0.001),
        text: body,
        style: get("Style") || undefined,
        speaker: get("Name") || undefined,
      });
    }
  }
  return { cues, styles, tags };
}

function parseAssTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4].padEnd(3, "0"), 10) / 1000;
}

function parseLrc(text: string): { cues: Cue[]; tags: Record<string, string> } {
  const cues: Cue[] = [];
  const tags: Record<string, string> = {};
  let offsetMs = 0;
  const lines = text.split(/\r\n|\r|\n/);
  const lrcTime = /^\[(\d{1,2}):(\d{2}(?:[.:]\d{1,3})?)\]/;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[(ti|ar|al|by|length|offset|re|ve|au|la):/i.test(line)) {
      const m = /^\[(\w+)\s*:\s*(.*)\]$/i.exec(line);
      if (m) {
        const key = m[1].toLowerCase();
        tags[key] = m[2].trim();
        if (key === "offset") {
          const v = parseFloat(m[2]);
          if (Number.isFinite(v)) offsetMs = v;
        }
      }
      continue;
    }
    // gather all leading [mm:ss.xx] timestamps
    const stamps: number[] = [];
    let rest = line;
    let m: RegExpExecArray | null;
    while ((m = lrcTime.exec(rest))) {
      const min = parseInt(m[1], 10);
      const sec = parseFloat(m[2].replace(":", "."));
      stamps.push(min * 60 + sec + offsetMs / 1000);
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;
    const body = cleanCueText(rest.replace(/<\d{1,2}:\d{2}(?:[.:]\d{1,3})?>/g, ""));
    for (const t of stamps) {
      cues.push({ index: cues.length, start: Math.max(0, t), end: Math.max(0, t) + 3, text: body });
    }
  }
  cues.sort((a, b) => a.start - b.start || a.index - b.index);
  // end of each cue = start of the next
  const lengthTag = tags.length ? parseLrcLength(tags.length) : null;
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const fallback = i === cues.length - 1 ? lengthTag ?? cues[i].start + 5 : cues[i].start + 5;
    cues[i].end = next ? Math.max(next.start - 0.01, cues[i].start + 0.2) : fallback;
    cues[i].index = i;
  }
  return { cues, tags };
}

function parseLrcLength(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?:[.:](\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0);
}

function detectSubtitleKind(text: string, ext: string): "srt" | "vtt" | "ass" | "lrc" | null {
  const trimmed = text.trim();
  if (ext === "srt" || ext === "subrip") return "srt";
  if (ext === "vtt" || ext === "webvtt") return "vtt";
  if (ext === "ass") return "ass";
  if (ext === "ssa") return "ass";
  if (ext === "lrc") return "lrc";
  if (/^WEBVTT/i.test(trimmed)) return "vtt";
  if (/^\[[^\]]*\]\s*$/.test(trimmed.split("\n")[0] ?? "") && /\[Script Info\]/i.test(trimmed)) return "ass";
  if (/\[Script Info\]/i.test(trimmed) || /^Dialogue\s*:/im.test(trimmed)) return "ass";
  if (/^\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/m.test(trimmed) && !/-->/.test(trimmed)) return "lrc";
  if (/-->/m.test(trimmed)) {
    const m = TIME_LINE.exec(trimmed);
    if (m) return m[0].includes(",") ? "srt" : "vtt";
  }
  return null;
}

export function parseSubtitles(text: string, ext: string): SubtitleDoc {
  const kind = detectSubtitleKind(text, ext);
  if (!kind) throw new Error("Could not recognize a subtitle format (SRT / WebVTT / ASS-SSA / LRC).");
  let cues: Cue[] = [];
  let styles: AssStyle[] = [];
  const tags: Record<string, string> = {};
  let metaTitle = "";
  if (kind === "srt" || kind === "vtt") {
    cues = parseSrtVtt(text, kind);
  } else if (kind === "ass") {
    const r = parseAss(text);
    cues = r.cues;
    styles = r.styles;
    Object.assign(tags, r.tags);
    metaTitle = r.tags.title ?? "";
  } else {
    const r = parseLrc(text);
    cues = r.cues;
    Object.assign(tags, r.tags);
    metaTitle = r.tags.ti ?? "";
  }
  if (!cues.length) throw new Error("No subtitle cues found in the file.");
  const duration = cues.reduce((acc, c) => Math.max(acc, c.end), 0);
  return { kind, cues, duration, styleCount: styles.length, styles, tags, metaTitle };
}

function cuesToSrt(cues: Cue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

function cuesToVtt(cues: Cue[]): string {
  return (
    "WEBVTT\n\n" +
    cues.map((c) => `${toVttTime(c.start)} --> ${toVttTime(c.end)}\n${c.text}`).join("\n\n") +
    "\n"
  );
}

/* ------------------------------ component ------------------------------ */

function wordsPerMinute(cues: Cue[], duration: number): number {
  if (duration <= 0) return 0;
  const words = cues.reduce((acc, c) => acc + c.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.round(words / (duration / 60));
}

export default function SubtitleViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [doc, setDoc] = React.useState<SubtitleDoc | null>(null);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<number | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const selectedRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (!arrayBuffer) {
      setPhase("error");
      setErrorMsg("This file exceeds the in-browser load cap (96 MB). Subtitle parsing needs the full text.");
      return;
    }
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("Subtitle files are capped at 32 MB in this viewer.");
      const text = decodeWith(new Uint8Array(arrayBuffer), "utf-8");
      const parsed = parseSubtitles(text, (detected.ext || fileName.split(".").pop() || "").toLowerCase());
      setDoc(parsed);
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [arrayBuffer, file.size, detected.ext, fileName]);

  React.useEffect(() => {
    if (selected === null || !selectedRef.current) return;
    selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const filtered = React.useMemo(() => {
    if (!doc) return [];
    const q = query.trim().toLowerCase();
    if (!q) return doc.cues;
    return doc.cues.filter((c) => c.text.toLowerCase().includes(q));
  }, [doc, query]);

  const wpm = doc ? wordsPerMinute(doc.cues, doc.duration) : 0;
  const densityLabel = wpm > 320 ? "very dense" : wpm > 200 ? "dense" : wpm > 100 ? "moderate" : "sparse";

  const exportFile = (format: "srt" | "vtt" | "txt") => {
    if (!doc) return;
    let content: string;
    let mime: string;
    if (format === "srt") {
      content = cuesToSrt(doc.cues);
      mime = "application/x-subrip";
    } else if (format === "vtt") {
      content = cuesToVtt(doc.cues);
      mime = "text/vtt";
    } else {
      /* plain transcript: [m:ss] stamps, speakers prefixed, one blank line between cues */
      content =
        doc.cues
          .map((c) => {
            const hh = Math.floor(c.start / 3600);
            const mm = Math.floor((c.start % 3600) / 60);
            const ss = Math.floor(c.start % 60);
            const stamp = hh > 0
              ? `[${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}] `
              : `[${mm}:${String(ss).padStart(2, "0")}] `;
            const speaker = c.speaker ? `${c.speaker}: ` : "";
            return stamp + speaker + c.text.split("\n").join(" ");
          })
          .join("\n\n") + "\n";
      mime = "text/plain;charset=utf-8";
    }
    const base = fileName.replace(/\.[^.]+$/, "") || "subtitles";
    downloadBlob(content, `${base}.${format}`, mime);
  };

  const timelineTicks = React.useMemo(() => {
    if (!doc || doc.duration <= 0) return [] as number[];
    const ticks: number[] = [];
    const step = doc.duration > 3600 ? 600 : doc.duration > 900 ? 120 : doc.duration > 120 ? 30 : 10;
    for (let t = 0; t <= doc.duration; t += step) ticks.push(t);
    return ticks;
  }, [doc]);

  const highlight = (text: string): React.ReactNode => {
    const q = query.trim();
    if (!q) return text;
    const lower = text.toLowerCase();
    const ql = q.toLowerCase();
    const out: React.ReactNode[] = [];
    let pos = 0;
    let key = 0;
    for (;;) {
      const idx = lower.indexOf(ql, pos);
      if (idx === -1) break;
      out.push(text.slice(pos, idx));
      out.push(
        <mark key={key++} className="rounded bg-amber-400/30 px-0.5 text-amber-200">
          {text.slice(idx, idx + q.length)}
        </mark>,
      );
      pos = idx + q.length;
    }
    out.push(text.slice(pos));
    return out;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">
              <Captions className="h-3 w-3" />
              {doc ? doc.kind.toUpperCase() : "Subs"}
            </Chip>
            {doc ? (
              <>
                <Chip>{doc.cues.length} cues</Chip>
                <Chip>
                  <Clock className="h-3 w-3" />
                  {formatDuration(doc.duration)}
                </Chip>
                <Chip tone={wpm > 320 ? "amber" : "teal"}>≈{wpm} wpm · {densityLabel}</Chip>
              </>
            ) : null}
          </>
        }
        right={
          <>
            <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-400 focus-within:border-emerald-700">
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cues…"
                className="w-28 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none sm:w-40"
              />
            </label>
            <ToolbarDivider />
            <ToolButton label="SRT" title="Download as SubRip .srt" onClick={() => exportFile("srt")}>
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="VTT" title="Download as WebVTT .vtt" onClick={() => exportFile("vtt")}>
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="TXT" title="Download plain-text transcript (timestamps + speakers)" onClick={() => exportFile("txt")}>
              <FileText className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />

      {phase === "error" ? (
        <ErrorCard
          title="Subtitle parse failed"
          message={errorMsg ?? "Unknown error"}
          hint="Supports SubRip (SRT), WebVTT, Advanced SubStation Alpha (ASS/SSA) and LRC lyrics — with SRT ↔ VTT conversion and plain-text transcript export."
        />
      ) : phase === "loading" ? (
        <LoadingState label="Parsing subtitles…" />
      ) : !doc ? (
        <EmptyHint>No cues.</EmptyHint>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl space-y-4 p-4">
            {/* timeline */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="relative h-9 select-none">
                <div className="absolute inset-x-0 top-4 h-3 overflow-hidden rounded-sm bg-zinc-950">
                  {doc.cues.map((c) => (
                    <button
                      key={c.index}
                      type="button"
                      title={`${fmtTime(c.start)} → ${fmtTime(c.end)} · ${c.text.split("\n")[0].slice(0, 60)}`}
                      onClick={() => setSelected(c.index)}
                      className={
                        selected === c.index
                          ? "absolute top-0 h-3 rounded-sm bg-amber-400 transition-colors hover:bg-amber-300"
                          : "absolute top-0 h-3 rounded-sm bg-emerald-600/70 transition-colors hover:bg-emerald-400"
                      }
                      style={{
                        left: `${(c.start / doc.duration) * 100}%`,
                        width: `${Math.max(0.35, ((c.end - c.start) / doc.duration) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
                {timelineTicks.map((t) => (
                  <div key={t} className="absolute top-0" style={{ left: `${(t / doc.duration) * 100}%` }}>
                    <div className="h-1 w-px bg-zinc-600" />
                    <div className="-translate-x-1/2 pt-0.5 font-mono text-[9px] text-zinc-500">{fmtTime(t).replace(/\.\d+$/, "")}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* search summary */}
            {query ? (
              <div className="text-[11px] text-zinc-500">
                {filtered.length} of {doc.cues.length} cues match “{query}”
              </div>
            ) : null}

            {/* ASS styles */}
            {doc.kind === "ass" && doc.styles.length ? (
              <SectionCard title="Styles" icon={<Type className="h-3.5 w-3.5" />} right={<Chip tone="teal">{doc.styles.length} styles</Chip>}>
                <div className="flex flex-wrap gap-1.5">
                  {doc.styles.map((s) => (
                    <Chip key={s.name} tone="zinc">
                      {s.name}
                      <span className="text-zinc-500">
                        {s.font} {s.size}
                      </span>
                    </Chip>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {/* LRC / ASS meta */}
            {doc.tags && Object.keys(doc.tags).length ? (
              <SectionCard title="Metadata" icon={<Tags className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  {Object.entries(doc.tags)
                    .filter(([k]) => ["title", "ti", "ar", "al", "by", "length", "scripttype", "generator", "playresx", "playresy", "wrapstyle", "scaledborderandshadow"].includes(k.toLowerCase()))
                    .slice(0, 10)
                    .map(([k, v]) => (
                      <Field key={k} label={k === "ti" ? "Title" : k === "ar" ? "Artist" : k === "al" ? "Album" : k === "by" ? "Author" : k === "length" ? "Length" : k}>
                        {k.toLowerCase() === "length" && parseLrcLength(v) !== null ? formatDuration(parseLrcLength(v)!) : v || "—"}
                      </Field>
                    ))}
                </InfoGrid>
              </SectionCard>
            ) : null}

            {/* cue cards */}
            <div className="space-y-1.5">
              {filtered.map((c) => {
                const isSel = selected === c.index;
                return (
                  <button
                    key={c.index}
                    ref={isSel ? selectedRef : undefined}
                    type="button"
                    onClick={() => setSelected(c.index)}
                    className={
                      isSel
                        ? "flex w-full items-start gap-3 rounded-lg border border-emerald-700/70 bg-emerald-900/20 p-3 text-left ring-1 ring-emerald-500/40"
                        : "flex w-full items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
                    }
                  >
                    <span className="w-14 shrink-0 pt-0.5 text-right font-mono text-[10px] leading-4 text-zinc-500">
                      {String(c.index + 1).padStart(3, "0")}
                    </span>
                    <span className="w-[7.5rem] shrink-0 pt-0.5 font-mono text-[10px] leading-4 text-amber-300/80">
                      {fmtTime(c.start)}
                      <br />
                      <span className="text-zinc-600">{fmtTime(c.end)}</span>
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-200">
                      {c.style ? <span className="mr-1.5 inline-block rounded border border-zinc-700 px-1 text-[9px] text-zinc-400">{c.style}</span> : null}
                      {c.speaker ? <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-teal-300/80">{c.speaker}:</span> : null}
                      {highlight(c.text)}
                    </span>
                  </button>
                );
              })}
              {!filtered.length ? <EmptyHint>No cues match the search.</EmptyHint> : null}
            </div>

            <div className="flex items-center gap-2 pb-1 text-[11px] text-zinc-500">
              <FileText className="h-3.5 w-3.5" />
              Click the timeline or a cue to highlight · export converts between SRT and VTT timing
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
