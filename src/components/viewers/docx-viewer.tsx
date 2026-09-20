"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip,
  SectionCard, InfoGrid, Field, EmptyHint, Copyable,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes, formatNum } from "@/lib/utils";
import { latin1, utf16LE } from "@/lib/utils";
import {
  FileText, Printer, Download, Copy, AlertTriangle, MessageSquareWarning, Image as ImageIcon,
  Binary, Type as TypeIcon,
} from "lucide-react";


const TEXT_CAP = 400_000;

/** Detect the legacy CFB (Compound File Binary) container used by .doc / .xls / .ppt. */
function isCfb(head: Uint8Array): boolean {
  return head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
    && head[4] === 0xa1 && head[5] === 0xe1 && head[6] === 0xb1 && head[7] === 0x1a;
}

/**
 * Best-effort text recovery for legacy binary Word documents: WordDocument stream
 * text is either cp1252 or UTF-16LE embedded in the CFB container. We decode both
 * ways over the raw file and keep whichever yields more word-like printable runs.
 */
function recoverLegacyDocText(bytes: Uint8Array): { text: string; mode: "utf-16" | "cp1252" } {
  const cap = Math.min(bytes.length, 16 * 1024 * 1024);
  const b = bytes.subarray(0, cap);

  const harvest = (decoded: string): { lines: string[]; letters: number } => {
    const lines: string[] = [];
    let letters = 0;
    const re = /[!-~\t ]{4,}/g; // printable ASCII runs, min 4 chars
    let m: RegExpExecArray | null;
    while ((m = re.exec(decoded))) {
      const run = m[0].trim();
      if (run.length < 4) continue;
      const letterCount = (run.match(/[A-Za-z]/g) || []).length;
      if (letterCount >= 2) {
        lines.push(run.length > 4000 ? run.slice(0, 4000) : run);
        letters += letterCount;
        if (lines.length > 6000) break;
      }
    }
    return { lines, letters };
  };

  const l1 = harvest(latin1(b));
  const u16 = harvest(utf16LE(b));
  const mode = u16.letters > l1.letters * 1.5 ? "utf-16" : "cp1252";
  const lines = mode === "utf-16" ? u16.lines : l1.lines;
  let text = lines.join("\n");
  if (text.length > TEXT_CAP) text = text.slice(0, TEXT_CAP) + "\n\n[truncated]";
  return { text, mode };
}

interface DocxState {
  html: string;
  warnings: string[];
  stats: { paragraphs: number; words: number; images: number };
}

interface LegacyState {
  text: string;
  mode: "utf-16" | "cp1252";
  lines: number;
}

const URI_REGEXP = /^(?:(?:https?|mailto|tel|callto|sms|cid|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export default function DocxViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [state, setState] = React.useState<DocxState | null>(null);
  const [legacy, setLegacy] = React.useState<LegacyState | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [showWarnings, setShowWarnings] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setState(null);
      setLegacy(null);
      setError(null);
      try {
        if (isCfb(head) || (detected.ext === "doc" && !arrayBuffer)) {
          // legacy binary Word document
          if (!arrayBuffer) {
            setError({
              message: "This legacy .doc file exceeds the in-memory load cap (96 MB).",
              hint: "Open the hex view instead, or split/convert the file before loading.",
            });
            return;
          }
          const bytes = new Uint8Array(arrayBuffer);
          const rec = recoverLegacyDocText(bytes);
          if (cancelled) return;
          setLegacy({ text: rec.text, mode: rec.mode, lines: rec.text ? rec.text.split("\n").length : 0 });
          return;
        }

        // OOXML .docx via mammoth
        if (!arrayBuffer) {
          setError({
            message: "This .docx file exceeds the in-memory load cap (96 MB).",
            hint: "Extract it from the archive first or use the hex view for inspection.",
          });
          return;
        }
        const mod: any = await import("mammoth");
        const mammoth = mod.default ?? mod;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(String(result.value ?? ""), {
          FORBID_TAGS: ["script", "style", "iframe", "form", "object", "embed", "link", "meta"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
          ALLOWED_URI_REGEXP: URI_REGEXP,
        });
        // stats + warnings
        const doc = new DOMParser().parseFromString(clean, "text/html");
        const text = doc.body.textContent ?? "";
        const stats = {
          paragraphs: doc.body.querySelectorAll("p, li").length,
          words: text.trim() ? text.trim().split(/\s+/).length : 0,
          images: doc.body.querySelectorAll("img").length,
        };
        const warnings = (result.messages ?? [])
          .map((msg: any) => `${String(msg?.type ?? "warning")}: ${String(msg?.message ?? "")}`.trim())
          .filter(Boolean)
          .slice(0, 30);
        if (cancelled) return;
        setState({ html: clean, warnings, stats });
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "The document could not be converted. It may be corrupted, DRM-protected, or not a real .docx (OOXML) file.",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, head, detected.ext]);

  /* ------------------------------ legacy .doc view ------------------------------ */
  if (legacy) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar
          left={
            <>
              <Chip tone="amber">Legacy .doc</Chip>
              <Chip tone="teal">text recovered</Chip>
              <Chip>{legacy.mode === "utf-16" ? "UTF-16LE" : "cp1252"} scan</Chip>
              <Chip>{formatNum(legacy.lines)} runs</Chip>
            </>
          }
          right={
            <>
              <ToolButton label="Copy" onClick={() => navigator.clipboard?.writeText(legacy.text)}><Copy className="h-3.5 w-3.5" /></ToolButton>
              <ToolButton label="Save .txt" onClick={() => downloadBlob(legacy.text, fileName.replace(/\.\w+$/, "") + "-recovered.txt", "text/plain")}><Download className="h-3.5 w-3.5" /></ToolButton>
            </>
          }
        />
        <ViewerBody className="p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            <SectionCard title="Legacy binary Word document" icon={<Binary className="h-3.5 w-3.5" />}>
              <div className="mb-3 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                Legacy .doc — text recovered. This is an OLE/CFB binary container, not OOXML; formatting,
                tables and images cannot be fully reconstructed client-side. Convert to .docx for a faithful view.
              </div>
              <InfoGrid>
                <Field label="Magic" mono>D0 CF 11 E0 A1 E1 B1 1A (CFB)</Field>
                <Field label="Size">{formatBytes(file.size)} ({formatNum(file.size)} B)</Field>
                <Field label="Format">{detected.name}</Field>
                <Field label="Recovery">{legacy.mode === "utf-16" ? "UTF-16LE printable runs" : "cp1252 printable runs"} ≥ 4 chars</Field>
                <Field label="File"><Copyable value={fileName} /></Field>
              </InfoGrid>
            </SectionCard>
            <SectionCard title="Recovered text" icon={<FileText className="h-3.5 w-3.5" />}>
              {legacy.text ? (
                <pre className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-zinc-300 scrollbar-thin">{legacy.text}</pre>
              ) : (
                <EmptyHint>No printable text runs found — the document may be empty, compressed or DRMed.</EmptyHint>
              )}
            </SectionCard>
          </div>
        </ViewerBody>
      </div>
    );
  }

  if (error) return <ErrorCard title="Cannot render this document" message={error.message} hint={error.hint} />;

  if (!state) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">Word</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Converting document…" />
      </div>
    );
  }

  /* ------------------------------ rendered docx view ------------------------------ */
  const exportHtml = () => {
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${fileName.replace(/</g, "&lt;")}</title>
<style>
body{max-width:52rem;margin:2.5rem auto;padding:0 1rem;font-family:Georgia,'Times New Roman',serif;line-height:1.7;color:#1c1c1c}
img{max-width:100%;height:auto} table{border-collapse:collapse;margin:1em 0}
td,th{border:1px solid #999;padding:4px 10px} h1,h2,h3{line-height:1.3}
</style></head><body>${state.html}</body></html>`;
    downloadBlob(page, fileName.replace(/\.\w+$/, "") + ".html", "text/html");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">Word</Chip>
            <Chip><span className="inline-flex items-center gap-1"><TypeIcon className="h-3 w-3" />{formatNum(state.stats.words)} words</span></Chip>
            <Chip>{formatNum(state.stats.paragraphs)} ¶</Chip>
            {state.stats.images ? <Chip tone="teal"><span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />{state.stats.images} img</span></Chip> : null}
            {state.warnings.length ? (
              <ToolButton
                active={showWarnings}
                label={`${state.warnings.length} warn`}
                onClick={() => setShowWarnings((s) => !s)}
                title="Conversion warnings"
                className="border-amber-800/60 bg-amber-900/30 text-amber-300"
              >
                <MessageSquareWarning className="h-3.5 w-3.5" />
              </ToolButton>
            ) : null}
          </>
        }
        right={
          <>
            <ToolbarDivider />
            <ToolButton label="Export HTML" onClick={exportHtml} title="Download as styled HTML"><Download className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Print" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />

      {showWarnings && state.warnings.length ? (
        <div className="max-h-44 shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-900/70 scrollbar-thin">
          {state.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 border-b border-zinc-800/50 px-3 py-1.5 text-[11px] text-amber-300/90">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
              <span className="min-w-0 break-words">{w}</span>
            </div>
          ))}
        </div>
      ) : null}

      <ViewerBody className="flex justify-center bg-zinc-950/40">
        <div className={cn("docx-body w-full max-w-3xl px-6 py-8")}>
          {state.html ? (
            <div dangerouslySetInnerHTML={{ __html: state.html }} />
          ) : (
            <EmptyHint>The document converted to an empty result — nothing to display.</EmptyHint>
          )}
        </div>
      </ViewerBody>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{fileName}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">{formatBytes(file.size)} · {detected.name} · converted with mammoth</span>
      </div>

      <style>{`
        .docx-body { color: #d4d4d8; font-size: 14.5px; line-height: 1.8; font-family: Georgia, 'Times New Roman', serif; }
        .docx-body p { margin: 0.7em 0; }
        .docx-body h1 { font-size: 1.75em; font-weight: 700; margin: 1.1em 0 0.45em; color: #fafafa; }
        .docx-body h2 { font-size: 1.45em; font-weight: 600; margin: 1em 0 0.4em; color: #f4f4f5; }
        .docx-body h3 { font-size: 1.2em; font-weight: 600; margin: 0.9em 0 0.35em; color: #e4e4e7; }
        .docx-body h4, .docx-body h5, .docx-body h6 { font-weight: 600; margin: 0.8em 0 0.3em; color: #e4e4e7; }
        .docx-body a { color: #34d399; text-underline-offset: 2px; }
        .docx-body strong { color: #fafafa; font-weight: 700; }
        .docx-body em { color: #e4e4e7; }
        .docx-body ul { list-style: disc; padding-left: 1.6em; margin: 0.6em 0; }
        .docx-body ol { list-style: decimal; padding-left: 1.6em; margin: 0.6em 0; }
        .docx-body li { margin: 0.3em 0; }
        .docx-body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 13px; }
        .docx-body th { border: 1px solid #3f3f46; background: #1c1c1f; padding: 6px 12px; text-align: left; color: #e4e4e7; }
        .docx-body td { border: 1px solid #2c2c33; padding: 6px 12px; }
        .docx-body tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
        .docx-body img { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid #2c2c33; margin: 0.4em 0; }
        .docx-body blockquote { border-left: 3px solid #065f46; padding: 0.2em 1em; margin: 0.8em 0; color: #a1a1aa; background: rgba(6,95,70,0.08); }
        .docx-body hr { border: 0; border-top: 1px solid #2c2c33; margin: 1.8em 0; }
      `}</style>
    </div>
  );
}
