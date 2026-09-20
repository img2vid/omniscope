"use client";

import * as React from "react";
import { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, ToolbarSelect, Chip } from "./viewer-ui";
import { cn, downloadBlob, ENCODINGS, decodeWith, guessTextEncoding, formatNum } from "@/lib/utils";
import { LANG_BY_EXT } from "@/lib/hlsyntax";
import {
  Search, WrapText, ListOrdered, Copy, Download, Hash, ChevronsUpDown, CaseSensitive,
} from "lucide-react";

const MAX_DECODE = 4 * 1024 * 1024;
const LINE_H = 21;

interface Line { n: number; text: string; }

export default function CodeViewer({ file, arrayBuffer, head, detected, fileName, forcedPlain }: ViewerProps & { forcedPlain?: boolean }) {
  const [encoding, setEncoding] = React.useState<string>("utf-8");
  const [guessed, setGuessed] = React.useState<string>("");
  const [lines, setLines] = React.useState<Line[] | null>(null);
  const [truncated, setTruncated] = React.useState(false);
  const [wrap, setWrap] = React.useState(false);
  const [numbers, setNumbers] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(600);
  const [lang, setLang] = React.useState<string>("");
  const [hlReady, setHlReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [gotoLine, setGotoLine] = React.useState("");
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const matchRef = React.useRef<HTMLInputElement>(null);

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // ---- load text ----
  React.useEffect(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const g = guessTextEncoding(bytes);
    setGuessed(g.label);
    setEncoding(g.label);
    let src = bytes;
    if (src.length > MAX_DECODE) {
      src = src.subarray(0, MAX_DECODE);
      setTruncated(true);
    }
    let text: string;
    try {
      text = decodeWith(src, g.label);
    } catch (e) {
      setError(String(e));
      return;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const ls = text.split(/\r\n|\r|\n/);
    setLines(ls.map((t, i) => ({ n: i + 1, text: t })));
  }, [arrayBuffer, head]);

  // ---- language + highlight.js ----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (forcedPlain) { setLang(""); return; }
      const candidate =
        detected.record?.cat === "code" ? LANG_BY_EXT[ext] ?? "" : LANG_BY_EXT[ext] ?? "";
      const scriptish = /^\s*#!.*\b(bash|sh|zsh|python|perl|ruby|node|php)\b/.test(lines?.[0]?.text ?? "");
      if (!candidate && scriptish) setLang("bash");
      else setLang(candidate);
      if (!candidate && !scriptish) return;
      try {
        const hljs = (await import("highlight.js/lib/common")).default;
        if (!cancelled) { (window as unknown as Record<string, unknown>).__hljs = hljs; setHlReady(true); }
      } catch { /* highlighting unavailable */ }
    })();
    return () => { cancelled = true; };
  }, [ext, forcedPlain, lines, detected]);

  // re-decode when encoding changes
  React.useEffect(() => {
    if (!lines || encoding === guessed) return;
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    let src = bytes;
    if (src.length > MAX_DECODE) src = src.subarray(0, MAX_DECODE);
    try {
      let text = decodeWith(src, encoding);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const ls = text.split(/\r\n|\r|\n/);
      setLines(ls.map((t, i) => ({ n: i + 1, text: t })));
    } catch { /* keep previous */ }
  }, [encoding]);  

  // ---- search matches ----
  const matches = React.useMemo(() => {
    if (!lines || !query.trim()) return [] as { line: number; col: number }[];
    const q = caseSensitive ? query : query.toLowerCase();
    const out: { line: number; col: number }[] = [];
    for (const l of lines) {
      const hay = caseSensitive ? l.text : l.text.toLowerCase();
      let col = hay.indexOf(q);
      while (col >= 0 && out.length < 500) {
        out.push({ line: l.n, col });
        col = hay.indexOf(q, col + 1);
      }
    }
    return out;
  }, [lines, query, caseSensitive]);

  // ---- virtualized window ----
  const total = lines?.length ?? 0;
  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - 10);
  const count = Math.ceil(viewportH / LINE_H) + 20;
  const visible = lines?.slice(first, first + count) ?? [];

  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const hljs = hlReady ? ((window as unknown as Record<string, unknown>).__hljs as typeof import("highlight.js/lib/common").default) : null;

  function renderLine(l: Line): React.ReactNode {
    if (hljs && lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(l.text, { language: lang, ignoreIllegals: true }).value;
        return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
      } catch { /* fall through */ }
    }
    return <code>{l.text || " "}</code>;
  }

  function jumpToLine(n: number) {
    const el = bodyRef.current;
    if (el) {
      el.scrollTo({ top: Math.max(0, (n - 1) * LINE_H - el.clientHeight / 3), behavior: "smooth" });
      matchRef.current?.focus();
    }
  }

  if (error) return <ErrorCard title="Could not decode file" message={error} />;
  if (!lines) return <LoadingState label="Decoding text…" />;

  const encodingOptions = ENCODINGS.flatMap((g) => g.labels).map((l) => ({ value: l, label: l }));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <ToolbarSelect
              label="enc"
              value={encoding}
              onChange={setEncoding}
              options={[{ value: guessed, label: `${guessed} (auto)` }, ...encodingOptions.filter((o) => o.value !== guessed)]}
            />
            {lang ? <Chip tone="emerald">{lang}</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-sm items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              ref={matchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search in file…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {query ? (
              <span className="shrink-0 px-1 text-[10px] text-zinc-500">{formatNum(matches.length)} hits</span>
            ) : null}
            <button
              type="button"
              title="Case sensitive"
              onClick={() => setCaseSensitive((v) => !v)}
              className={cn("flex h-full w-7 items-center justify-center", caseSensitive ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-300")}
            >
              <CaseSensitive className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        right={
          <>
            <div className="flex h-7 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
              <Hash className="h-3.5 w-3.5 text-zinc-500" />
              <input
                value={gotoLine}
                onChange={(e) => setGotoLine(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && gotoLine) jumpToLine(parseInt(gotoLine, 10));
                }}
                placeholder="line…"
                className="h-full w-14 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
              />
            </div>
            <ToolButton label="Wrap" active={wrap} onClick={() => setWrap((v) => !v)}><WrapText className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="123" active={numbers} onClick={() => setNumbers((v) => !v)} title="Line numbers"><ListOrdered className="h-3.5 w-3.5" /></ToolButton>
            <ToolbarDivider />
            <ToolButton label="Copy" onClick={() => navigator.clipboard?.writeText(lines.map((l) => l.text).join("\n"))}><Copy className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Save" onClick={() => downloadBlob(new Blob([lines.map((l) => l.text).join("\n")], { type: "text/plain" }), fileName + ".txt")}><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />
      <ViewerBody scrollRef={bodyRef} onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}>
        {matches.length > 0 && matches[0] ? (
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-emerald-900/50 bg-zinc-950/95 px-3 py-1.5 text-[11px] text-emerald-300">
            <ChevronsUpDown className="h-3 w-3" />
            <span>{formatNum(matches.length)} matches</span>
            <div className="ml-auto flex gap-1">
              {matches.slice(0, 12).map((m, i) => (
                <button key={i} onClick={() => jumpToLine(m.line)} className="rounded border border-emerald-900/60 px-1.5 py-0.5 hover:bg-emerald-900/40">
                  :{m.line}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="relative font-mono text-[13px] leading-[21px]">
          <div style={{ height: total * LINE_H }} className="relative">
            <div style={{ transform: `translateY(${first * LINE_H}px)` }} className="absolute inset-x-0 top-0">
              {visible.map((l) => {
                const isMatch = query.trim() && matches.some((m) => m.line === l.n);
                return (
                  <div
                    key={l.n}
                    className={cn(
                      "flex whitespace-pre",
                      isMatch ? "bg-amber-900/20" : "hover:bg-zinc-900/40",
                      wrap && "whitespace-pre-wrap break-all",
                    )}
                  >
                    {numbers ? (
                      <span className="sticky left-0 z-[1] w-14 shrink-0 select-none border-r border-zinc-800/70 bg-zinc-950/90 pr-2 text-right text-[11px] text-zinc-600">
                        {l.n}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 pl-3 text-zinc-300">{renderLine(l)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {truncated ? (
          <div className="border-t border-amber-900/40 bg-amber-950/20 px-3 py-2 text-center text-[11px] text-amber-300">
            Showing first {formatNum(MAX_DECODE / 1024)} KB — file truncated for performance
          </div>
        ) : null}
      </ViewerBody>
      <style>{`
        .hljs { color: #d4d4d8; }
        .hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: #6ee7b7; }
        .hljs-string, .hljs-regexp, .hljs-addition { color: #fcd34d; }
        .hljs-number, .hljs-literal { color: #fda4af; }
        .hljs-comment, .hljs-quote { color: #71717a; font-style: italic; }
        .hljs-title, .hljs-name, .hljs-type { color: #5eead4; }
        .hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable { color: #c4b5fd; }
        .hljs-symbol, .hljs-bullet, .hljs-meta { color: #fdba74; }
        .hljs-section, .hljs-emphasis { font-style: italic; }
        .hljs-strong { font-weight: 600; }
      `}</style>
    </div>
  );
}
