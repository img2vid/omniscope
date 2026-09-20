"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, ErrorCard, LoadingState, Chip, Segmented,
  SectionCard, InfoGrid, Field, Copyable,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes, formatNum } from "@/lib/utils";
import { u16be, u32be, asciiAt, findAscii } from "@/lib/binary";
import { BookOpen, FileText, Download, Info, Binary } from "lucide-react";

const TEXT_CAP = 24 * 1024 * 1024; // safety cap for decompressed text
const DOMPURIFY_URI = /^(?:(?:https?|mailto|tel|callto|sms|cid|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

interface MobiInfo {
  name: string;
  type: string;
  creator: string;
  numRecords: number;
  compression: number;
  compressionLabel: string;
  encryption: number;
  textLength: number;
  textRecordCount: number;
  recordSize: number;
  encodingLabel: string;
  mobiType: number | null;
  fileVersion: number | null;
  fullName: string;
  extraFlags: number;
  isKf8: boolean;
  layoutNote: string;
}

interface MobiState {
  info: MobiInfo;
  html: string | null; // decoded (sanitized) book HTML
  rawText: string | null;
  textChars: number;
  truncated: boolean;
  fatal?: string;
}

/* ------------------------------ PalmDOC LZ77 ------------------------------ */

function palmDocDecompress(src: Uint8Array, dest: Uint8Array, destStart: number): number {
  let i = 0;
  let o = destStart;
  const dlen = dest.length;
  const slen = src.length;
  while (i < slen && o < dlen) {
    const c = src[i++];
    if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < slen; k++) {
        if (o < dlen) dest[o] = src[i];
        o++;
        i++;
      }
    } else if (c < 0x80) {
      dest[o++] = c;
    } else if (c >= 0xc0) {
      if (o < dlen) dest[o] = 0x20;
      o++;
      if (o < dlen) dest[o] = c & 0x7f;
      o++;
    } else {
      if (i >= slen) break;
      const v = ((c << 8) | src[i++]) & 0xffff;
      const dist = (v >> 3) & 0x7ff;
      const len = (v & 7) + 3;
      for (let k = 0; k < len; k++) {
        if (o >= dlen) break;
        const back = o - dist;
        dest[o] = back >= 0 ? dest[back] : 0;
        o++;
      }
    }
  }
  return o;
}

/** strip MOBI trailing-entry bytes (extra flags) from a text record */
function trimTrailingEntries(data: Uint8Array, flags: number): Uint8Array {
  let end = data.length;
  try {
    let trailers = (flags >> 1) & 0x7fff;
    while (trailers > 0 && end > 0) {
      if (trailers & 1) {
        const size = (data[end - 1] & 0xff) + 1;
        if (size > end) return data; // corrupt — keep as-is
        end -= size;
      }
      trailers >>= 1;
    }
    if (flags & 1 && end > 0) {
      if (data[end - 1] & 0x80) end -= Math.min(2, end);
      else end -= 1;
    }
  } catch { /* keep as-is */ }
  return data.subarray(0, Math.max(0, end));
}

/* ------------------------------ MOBI parsing ------------------------------ */

function compressionLabel(c: number): string {
  if (c === 1) return "none";
  if (c === 2) return "PalmDOC LZ77";
  if (c === 17480) return "HUFF/CDIC";
  return `unknown (${c})`;
}

function parseMobi(bytes: Uint8Array): MobiState {
  if (bytes.length < 200) throw new Error("file too small to be a MOBI book");
  const name = asciiAt(bytes, 0, 32).replace(/\0[\s\S]*$/, "").trim();
  let type = asciiAt(bytes, 0x3c, 4);
  let creator = asciiAt(bytes, 0x40, 4);
  let numRecords = u16be(bytes, 0x4c);
  let recordList = 0x50;
  // validate: record 0 must start with a plausible PalmDOC header
  const looksValid = (recList: number, count: number): boolean => {
    if (count <= 0 || count > 65535) return false;
    if (recList + count * 8 > bytes.length) return false;
    const off0 = u32be(bytes, recList);
    if (off0 < recList + count * 8 || off0 + 16 > bytes.length) return false;
    const comp = u16be(bytes, off0);
    if (comp !== 1 && comp !== 2 && comp !== 17480) return false;
    return true;
  };
  if (!looksValid(recordList, numRecords)) {
    // alternate layout: 4-byte count, records at 0x54
    const altCount = u32be(bytes, 0x50);
    if (looksValid(0x54, altCount)) {
      numRecords = altCount;
      recordList = 0x54;
      type = asciiAt(bytes, 0x40, 4);
      creator = asciiAt(bytes, 0x44, 4);
    }
  }
  const recordOffset = (i: number): number => {
    if (i < numRecords) return u32be(bytes, recordList + i * 8);
    return bytes.length;
  };
  const rec0Start = recordOffset(0);
  const rec0End = Math.min(recordOffset(1) || bytes.length, bytes.length);
  const rec0 = bytes.subarray(rec0Start, rec0End);

  const compression = u16be(rec0, 0);
  const textLength = u32be(rec0, 4);
  const textRecordCount = u16be(rec0, 8);
  const recordSize = u16be(rec0, 10);
  const encryption = u16be(rec0, 12);

  // MOBI header (record 0, offset 16)
  let encoding = 1252;
  let mobiType: number | null = null;
  let fileVersion: number | null = null;
  let fullName = "";
  let extraFlags = 0;
  const hasMobiHeader = rec0.length > 20 && findAscii(rec0, "MOBI", 12, 24) === 16;
  if (hasMobiHeader) {
    const headerLen = u32be(rec0, 20);
    mobiType = u32be(rec0, 24);
    encoding = u32be(rec0, 28) === 65001 ? 65001 : 1252;
    fileVersion = u32be(rec0, 36);
    if (headerLen >= 0x4c && rec0.length >= 16 + 0x4c) {
      const fno = u32be(rec0, 16 + 0x44);
      const fnl = u32be(rec0, 16 + 0x48);
      if (fno > 0 && fnl > 0 && fno + fnl <= rec0.length) {
        fullName = asciiAt(rec0, fno, fnl).replace(/\0/g, "").trim();
      }
    }
    if (headerLen >= 0xe4 && rec0.length >= 0xf4) {
      extraFlags = u16be(rec0, 0xf2);
    }
  }

  const isKf8 = fileVersion === 8;
  const info: MobiInfo = {
    name: name || fullName || "(untitled book)",
    type: type.trim(),
    creator: creator.trim(),
    numRecords,
    compression,
    compressionLabel: compressionLabel(compression),
    encryption,
    textLength,
    textRecordCount,
    recordSize,
    encodingLabel: encoding === 65001 ? "UTF-8" : "cp1252",
    mobiType,
    fileVersion,
    fullName,
    extraFlags,
    isKf8,
    layoutNote: isKf8 ? "KF8/AZW3 hybrid — best-effort text extraction" : "MOBI 6 layout",
  };

  if (encryption !== 0) {
    throw Object.assign(
      new Error(`DRM-protected book (encryption type ${encryption})`),
      { hint: "DRMed Kindle books cannot be decrypted client-side." },
    );
  }
  if (compression !== 1 && compression !== 2) {
    return {
      info,
      html: null,
      rawText: null,
      textChars: 0,
      truncated: false,
      fatal: `Unsupported compression (${compressionLabel(compression)}) — only uncompressed and PalmDOC LZ77 records are handled.`,
    };
  }

  // decompress text records 1..textRecordCount
  const totalLen = Math.min(textLength > 0 ? textLength : TEXT_CAP, TEXT_CAP);
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  const lastTextRecord = Math.min(textRecordCount, numRecords - 1);
  for (let i = 1; i <= lastTextRecord && cursor < totalLen; i++) {
    const start = recordOffset(i);
    const end = Math.min(recordOffset(i + 1), bytes.length);
    if (start >= end) continue;
    const raw = trimTrailingEntries(bytes.subarray(start, end), extraFlags);
    if (compression === 1) {
      for (let k = 0; k < raw.length && cursor < totalLen; k++) out[cursor++] = raw[k];
    } else {
      cursor = palmDocDecompress(raw, out, cursor);
    }
  }
  const textBytes = out.subarray(0, cursor);
  const decoder = new TextDecoder(encoding === 65001 ? "utf-8" : "windows-1252", { fatal: false });
  const rawText = decoder.decode(textBytes);

  return {
    info,
    rawText,
    html: rawText, // sanitized at render time
    textChars: rawText.length,
    truncated: textLength > TEXT_CAP,
  };
}

/* ------------------------------ component ------------------------------ */

export default function MobiViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [state, setState] = React.useState<MobiState | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [mode, setMode] = React.useState<"render" | "raw">("render");
  const [showInfo, setShowInfo] = React.useState(false);
  const [safeHtml, setSafeHtml] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setState(null);
      setError(null);
      setSafeHtml(null);
      try {
        if (!arrayBuffer) {
          setError({
            message: "This book exceeds the in-memory load cap (96 MB).",
            hint: "Extract or split the file before loading, or inspect it with the hex viewer.",
          });
          return;
        }
        const parsed = parseMobi(new Uint8Array(arrayBuffer));
        if (cancelled) return;
        setState(parsed);
        if (parsed.html) {
          const DOMPurify = (await import("dompurify")).default;
          const clean = DOMPurify.sanitize(parsed.html, {
            FORBID_TAGS: ["script", "style", "iframe", "form", "object", "embed", "link", "meta"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
            ALLOWED_URI_REGEXP: DOMPURIFY_URI,
          });
          if (cancelled) return;
          setSafeHtml(clean);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError({ message: String(e?.message ?? e), hint: e?.hint ?? "The PDB/MOBI structure could not be parsed — this may not be a Mobi file." });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer]);

  if (error) return <ErrorCard title="Cannot open this Mobi book" message={error.message} hint={error.hint} />;

  if (!state) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">Mobi</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Decompressing book…" />
      </div>
    );
  }

  const { info } = state;
  const exportHtml = () => {
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${(info.fullName || info.name).replace(/</g, "&lt;")}</title>
<style>body{max-width:40rem;margin:2rem auto;padding:0 1rem;font-family:Georgia,serif;line-height:1.7;color:#222}img{max-width:100%}</style>
</head><body>${state.rawText ?? ""}</body></html>`;
    downloadBlob(page, fileName.replace(/\.\w+$/, "") + ".html", "text/html");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{info.isKf8 ? "AZW3/KF8" : "Mobi"}</Chip>
            <Chip>{formatNum(info.numRecords)} records</Chip>
            <Chip tone="teal">{info.encodingLabel}</Chip>
            <Chip>{info.compressionLabel}</Chip>
            {state.textChars ? <Chip>{formatNum(state.textChars)} chars</Chip> : null}
            <ToolButton active={showInfo} label="Info" onClick={() => setShowInfo((s) => !s)} title="File header info"><Info className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
        right={
          <>
            {state.rawText ? (
              <>
                <Segmented value={mode} onChange={(v) => setMode(v)} options={[{ value: "render", label: "Rendered" }, { value: "raw", label: "Raw HTML" }]} />
                <ToolButton label="Export" onClick={exportHtml} title="Download as HTML"><Download className="h-3.5 w-3.5" /></ToolButton>
              </>
            ) : null}
          </>
        }
      />

      {showInfo ? (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mx-auto max-w-3xl">
            <SectionCard title="PDB / MOBI header" icon={<Binary className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Book name"><Copyable value={info.name} /></Field>
                <Field label="Full title">{info.fullName || "—"}</Field>
                <Field label="PDB type" mono>{info.type || "—"} / {info.creator || "—"}</Field>
                <Field label="Records" mono>{info.numRecords} (text: {info.textRecordCount})</Field>
                <Field label="Compression" mono>{info.compressionLabel} · record size {info.recordSize}</Field>
                <Field label="Encoding" mono>{info.encodingLabel}</Field>
                <Field label="Text length" mono>{formatBytes(info.textLength)} uncompressed{state.truncated ? " (truncated to 24 MB)" : ""}</Field>
                <Field label="MOBI type" mono>{info.mobiType ?? "— (plain PalmDOC)"}</Field>
                <Field label="File version" mono>{info.fileVersion ?? "—"} · {info.layoutNote}</Field>
                <Field label="Extra flags" mono>0x{info.extraFlags.toString(16)}</Field>
              </InfoGrid>
            </SectionCard>
          </div>
        </div>
      ) : null}

      {state.fatal ? (
        <ViewerBody className="p-4">
          <div className="mx-auto max-w-md rounded-xl border border-amber-900/50 bg-amber-950/20 p-5 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-amber-400" />
            <div className="text-sm font-semibold text-amber-200">{state.fatal}</div>
            <div className="mt-2 text-xs text-amber-300/80">The book header parsed correctly — see the Info panel for details.</div>
          </div>
        </ViewerBody>
      ) : !state.rawText ? (
        <ViewerBody className="p-4">
          <div className="mx-auto max-w-md rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 text-center text-sm text-zinc-400">
            No text could be extracted from this book.
          </div>
        </ViewerBody>
      ) : mode === "render" ? (
        <ViewerBody className="flex justify-center bg-zinc-950/70">
          <div className="mobi-body w-full max-w-2xl px-6 py-10">
            {safeHtml === null ? (
              <div className="flex items-center gap-2 py-16 text-sm text-zinc-500">
                <BookOpen className="h-4 w-4 animate-pulse text-emerald-400" />
                Sanitizing book…
              </div>
            ) : (
              <div className={cn(!safeHtml.trim() && "hidden")} dangerouslySetInnerHTML={{ __html: safeHtml }} />
            )}
            {safeHtml !== null && !safeHtml.trim() ? (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-300">
                The decompressed records contain no renderable HTML — this may be an AZW3/KF8 book whose text
                lives in a different section. Switch to “Raw HTML” to inspect what was recovered.
              </div>
            ) : null}
          </div>
        </ViewerBody>
      ) : (
        <ViewerBody>
          <pre className="whitespace-pre-wrap break-words px-6 py-8 font-mono text-[11.5px] leading-5 text-zinc-300">
            {state.rawText.length > 1_000_000 ? state.rawText.slice(0, 1_000_000) + "\n\n[…truncated — showing first 1 MB of " + formatNum(state.rawText.length) + " chars]" : state.rawText}
          </pre>
        </ViewerBody>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{info.name}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">{formatBytes(file.size)} · {detected.name}</span>
      </div>

      <style>{`
        .mobi-body { color: #d6d3d1; font-family: Georgia, 'Times New Roman', serif; font-size: 16.5px; line-height: 1.75; }
        .mobi-body p { margin: 0.65em 0; }
        .mobi-body h1, .mobi-body h2, .mobi-body h3, .mobi-body h4 { color: #f5f5f4; font-weight: 600; margin: 1.1em 0 0.45em; line-height: 1.35; }
        .mobi-body h1 { font-size: 1.55em; } .mobi-body h2 { font-size: 1.3em; } .mobi-body h3 { font-size: 1.12em; }
        .mobi-body a { color: #34d399; text-decoration: underline; text-underline-offset: 2px; }
        .mobi-body img { max-width: 100%; height: auto; border-radius: 4px; }
        .mobi-body ul { list-style: disc; padding-left: 1.5em; margin: 0.5em 0; }
        .mobi-body ol { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
        .mobi-body li { margin: 0.25em 0; }
        .mobi-body blockquote { border-left: 3px solid #065f46; padding: 0.2em 1em; margin: 0.8em 0; color: #a8a29e; background: rgba(6,95,70,0.08); }
        .mobi-body hr { border: 0; border-top: 1px solid #2c2c33; margin: 1.6em 0; }
        .mobi-body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.9em; }
        .mobi-body td, .mobi-body th { border: 1px solid #2c2c33; padding: 4px 8px; }
        .mobi-body font { color: inherit; }
      `}</style>
    </div>
  );
}
