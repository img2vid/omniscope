"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, LoadingState, Segmented,
} from "./viewer-ui";
import { cn, downloadBlob } from "@/lib/utils";
import { Eye, Code2, ListTree, Copy, Printer, Download } from "lucide-react";

const MAX_MD = 2 * 1024 * 1024;

function extractHeadings(md: string): { level: number; text: string; id: string }[] {
  const out: { level: number; text: string; id: string }[] = [];
  let inCode = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    if (inCode) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].replace(/[#*`_~]/g, "").trim();
      out.push({ level: m[1].length, text, id: `h-${out.length}` });
    }
  }
  return out;
}

export default function MarkdownViewer({ arrayBuffer, head, fileName }: ViewerProps) {
  const [md, setMd] = React.useState<string | null>(null);
  const [html, setHtml] = React.useState<string>("");
  const [mode, setMode] = React.useState<"render" | "source">("render");
  const [toc, setToc] = React.useState<{ level: number; text: string; id: string }[]>([]);

  React.useEffect(() => {
    const bytes = (arrayBuffer ? new Uint8Array(arrayBuffer) : head).subarray(0, MAX_MD);
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    setMd(text);
    setToc(extractHeadings(text));
    (async () => {
      try {
        const { marked } = await import("marked");
        const rawHtml = await marked.parse(text, { gfm: true, breaks: false, async: true });
        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(rawHtml as string, {
          FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "style"],
        });
        // inject heading ids for TOC anchors
        const doc = new DOMParser().parseFromString(clean, "text/html");
        doc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h, i) => {
          h.id = `md-h-${i}`;
        });
        setHtml(doc.body.innerHTML);
      } catch (e) {
        setHtml(`<p>Render failed: ${String(e)}</p>`);
      }
    })();
  }, [arrayBuffer, head]);

  if (md === null) return <LoadingState label="Loading markdown…" />;

  const headings = toc;

  /** export a self-contained styled HTML document (dark, no external refs) */
  const saveStandaloneHtml = () => {
    if (!html) return;
    const tocHtml = headings.length > 1
      ? `<nav class="toc"><strong>Contents</strong><ul>${headings.map((h, i) =>
          `<li style="margin-left:${(h.level - 1) * 14}px"><a href="#md-h-${i}">${h.text.replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" }[c] ?? c))}</a></li>`).join("")}</ul></nav>`
      : "";
    const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Omniscope — client-side markdown export">
<title>${(fileName || "document").replace(/[<&>]/g, (c) => ({ "<": "&lt;", "&": "&amp;", ">": "&gt;" }[c] ?? c))}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #09090b; color: #d4d4d8; font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
h1, h2, h3, h4 { color: #fafafa; line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; border-bottom: 1px solid #27272a; padding-bottom: .3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #27272a; padding-bottom: .25em; }
h3 { font-size: 1.25em; }
a { color: #34d399; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em; background: #18181b; border: 1px solid #27272a; border-radius: 4px; padding: .15em .35em; }
pre { background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 14px 18px; overflow: auto; }
pre code { background: none; border: none; padding: 0; }
blockquote { border-left: 3px solid #10b981; margin: 1em 0; padding: .1em 1em; color: #a1a1aa; background: rgba(16,185,129,.05); border-radius: 0 6px 6px 0; }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
th, td { border: 1px solid #27272a; padding: 6px 12px; }
th { background: #18181b; color: #fafafa; }
tr:nth-child(even) td { background: rgba(24,24,27,.5); }
img { max-width: 100%; border-radius: 8px; }
hr { border: none; border-top: 1px solid #27272a; margin: 2em 0; }
.toc { border: 1px solid #27272a; background: #18181b; border-radius: 8px; padding: 12px 18px; margin-bottom: 32px; }
.toc strong { color: #fafafa; }
.toc ul { list-style: none; margin: 8px 0 0; padding: 0; font-size: 14px; }
.toc a { text-decoration: none; }
.toc a:hover { text-decoration: underline; }
footer { max-width: 760px; margin: 0 auto; padding: 0 24px 32px; color: #52525b; font-size: 12px; }
</style>
</head>
<body>
<main>
${tocHtml}
${html}
</main>
<footer>exported from markdown by Omniscope — 100% client-side</footer>
</body>
</html>`;
    downloadBlob(doc, (fileName.replace(/\.[^.]+$/, "") || "document") + ".html", "text/html;charset=utf-8");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Segmented value={mode} onChange={setMode} options={[{ value: "render", label: "Rendered" }, { value: "source", label: "Source" }]} />
            <ToolbarDivider />
            <ToolButton label="Copy MD" onClick={() => navigator.clipboard?.writeText(md)}><Copy className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Print" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="HTML" title="Export a standalone styled HTML document" onClick={saveStandaloneHtml}><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
        right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>}
      />
      <div className="flex min-h-0 flex-1">
        {headings.length > 2 && mode === "render" ? (
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/40 p-3 scrollbar-thin md:block" aria-label="Table of contents">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <ListTree className="h-3.5 w-3.5" /> Contents
            </div>
            {headings.map((h, i) => (
              <a
                key={i}
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const idx = headings.indexOf(h);
                  document.getElementById(`md-h-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn(
                  "block truncate rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-emerald-300",
                  h.level === 1 && "font-semibold text-zinc-300",
                )}
                style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
              >
                {h.text}
              </a>
            ))}
          </nav>
        ) : null}
        <ViewerBody className="flex justify-center">
          {mode === "render" ? (
            <div className="markdown-body max-w-3xl flex-1 px-6 py-8">
              {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <LoadingState label="Rendering…" />}
            </div>
          ) : (
            <pre className="max-w-5xl flex-1 whitespace-pre-wrap px-6 py-8 font-mono text-[12.5px] leading-5 text-zinc-300">{md}</pre>
          )}
        </ViewerBody>
      </div>
      <style>{`
        .markdown-body { color: #d4d4d8; font-size: 14px; line-height: 1.75; }
        .markdown-body h1 { font-size: 1.9em; font-weight: 700; margin: 1em 0 0.5em; color: #fafafa; border-bottom: 1px solid #3f3f46; padding-bottom: 0.3em; }
        .markdown-body h2 { font-size: 1.5em; font-weight: 600; margin: 1.2em 0 0.5em; color: #fafafa; border-bottom: 1px solid #27272a; padding-bottom: 0.25em; }
        .markdown-body h3 { font-size: 1.25em; font-weight: 600; margin: 1em 0 0.4em; color: #e4e4e7; }
        .markdown-body h4, .markdown-body h5, .markdown-body h6 { font-weight: 600; margin: 0.8em 0 0.3em; color: #e4e4e7; }
        .markdown-body p { margin: 0.7em 0; }
        .markdown-body a { color: #34d399; text-decoration: underline; text-underline-offset: 2px; }
        .markdown-body a:hover { color: #6ee7b7; }
        .markdown-body code { background: #1c1c1f; border: 1px solid #303035; border-radius: 4px; padding: 0.1em 0.35em; font-family: var(--font-geist-mono), monospace; font-size: 0.85em; color: #fbbf24; }
        .markdown-body pre { background: #101013; border: 1px solid #2c2c33; border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 1em 0; }
        .markdown-body pre code { background: none; border: none; padding: 0; color: #d4d4d8; font-size: 12.5px; line-height: 1.6; }
        .markdown-body blockquote { border-left: 3px solid #065f46; padding: 0.2em 1em; margin: 0.8em 0; color: #a1a1aa; background: rgba(6,95,70,0.08); border-radius: 0 6px 6px 0; }
        .markdown-body ul { list-style: disc; padding-left: 1.6em; margin: 0.6em 0; }
        .markdown-body ol { list-style: decimal; padding-left: 1.6em; margin: 0.6em 0; }
        .markdown-body li { margin: 0.25em 0; }
        .markdown-body table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 13px; }
        .markdown-body th { border: 1px solid #3f3f46; background: #1c1c1f; padding: 6px 12px; text-align: left; color: #e4e4e7; }
        .markdown-body td { border: 1px solid #2c2c33; padding: 6px 12px; }
        .markdown-body tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
        .markdown-body img { max-width: 100%; border-radius: 8px; border: 1px solid #2c2c33; }
        .markdown-body hr { border: 0; border-top: 1px solid #2c2c33; margin: 2em 0; }
        .markdown-body kbd { border: 1px solid #3f3f46; border-bottom-width: 2px; border-radius: 4px; padding: 1px 5px; font-family: var(--font-geist-mono), monospace; font-size: 0.8em; background: #1c1c1f; }
      `}</style>
    </div>
  );
}
