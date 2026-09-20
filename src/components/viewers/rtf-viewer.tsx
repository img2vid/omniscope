"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip, Segmented,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes, formatNum } from "@/lib/utils";
import { FileText, Code2, Download, Palette, Braces } from "lucide-react";

const SOURCE_CAP = 8 * 1024 * 1024;

/* ------------------------------ cp1252 ------------------------------ */

const CP1252_HI: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡",
  0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function cp1252Char(code: number): string {
  const c = code & 0xff;
  if (c >= 0x80 && c <= 0x9f && CP1252_HI[c] !== undefined) return CP1252_HI[c];
  return String.fromCharCode(c);
}

/* ------------------------------ parser types ------------------------------ */

interface RtStyle {
  b: boolean;
  i: boolean;
  u: boolean;
  fs: number | null;      // half-points
  color: number | null;   // colortbl index
  align: "l" | "c" | "r" | "j";
  skip: boolean;
  inColortbl: boolean;
  uc: number;
  cr: number | null;
  cg: number | null;
  cb: number | null;
}

interface RtRun { text: string; b: boolean; i: boolean; u: boolean; fs: number | null; color: number | null }
interface RtPara { align: "l" | "c" | "r" | "j"; runs: RtRun[] }

interface RtfResult {
  paras: RtPara[];
  colors: (string | null)[];
  stats: { chars: number; groups: number; colors: number };
}

const SKIP_DESTS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "nonshppict", "header", "footer",
  "headerl", "headerr", "headerf", "footerl", "footerr", "footerf", "footnote", "listtable",
  "listoverridetable", "listtext", "pntext", "rsidtbl", "generator", "themedata", "colorschememapping",
  "datastore", "latentstyles", "panose", "xmlnstbl", "mmathpr", "fldinst", "object", "atnref",
  "atnid", "bkmkstart", "bkmkend", "template", "upr", "shpinst", "wgrffmtfilter", "worker",
]);

const SYMBOL_WORDS: Record<string, string> = {
  emdash: "—", endash: "–", emspace: " ", enspace: " ", qmspace: " ",
  bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  zwnbspace: " ", dwfilter: "", "nosupersub": "",
};

/* ------------------------------ parser ------------------------------ */

function parseRtf(src: string): RtfResult {
  const paras: RtPara[] = [{ align: "l", runs: [] }];
  let cur: RtStyle = {
    b: false, i: false, u: false, fs: null, color: null, align: "l",
    skip: false, inColortbl: false, uc: 1, cr: null, cg: null, cb: null,
  };
  const stack: RtStyle[] = [];
  const colors: (string | null)[] = [];
  let groups = 0;
  let chars = 0;
  let unicodeSkip = 0;
  let cpDecoder: TextDecoder | null = null;

  const pushColor = () => {
    if (cur.cr !== null && cur.cg !== null && cur.cb !== null) {
      colors.push(`rgb(${cur.cr},${cur.cg},${cur.cb})`);
    } else {
      colors.push(null); // \auto entry
    }
    cur.cr = null; cur.cg = null; cur.cb = null;
  };

  const emit = (text: string) => {
    if (!text) return;
    if (cur.inColortbl) {
      for (const ch of text) if (ch === ";") pushColor();
      return;
    }
    if (cur.skip) return;
    chars += text.length;
    const para = paras[paras.length - 1];
    para.align = cur.align; // capture alignment active while the paragraph has text
    const last = para.runs[para.runs.length - 1];
    if (last && last.b === cur.b && last.i === cur.i && last.u === cur.u && last.fs === cur.fs && last.color === cur.color) {
      last.text += text;
    } else {
      para.runs.push({ text, b: cur.b, i: cur.i, u: cur.u, fs: cur.fs, color: cur.color });
    }
  };

  const newPara = () => {
    const prev = paras[paras.length - 1];
    if (prev.runs.length === 0 && paras.length > 1) return; // avoid stacking empties
    paras.push({ align: cur.align, runs: [] });
  };

  let i = 0;
  const s = src;
  const n = s.length;

  const handleWord = (word: string, param: number | null): number => {
    if (SKIP_DESTS.has(word)) {
      if (word === "pict") emit("\n[image]\n"); // marker before the group is muted
      cur.skip = true;
      if (word === "colortbl") cur.inColortbl = true;
      return 0;
    }
    if (word === "bin") return param !== null ? param : 0;
    switch (word) {
      case "b": cur.b = param === null || param !== 0; break;
      case "i": cur.i = param === null || param !== 0; break;
      case "ul":
      case "ulw":
      case "uld":
      case "uldb":
        cur.u = param === null || param !== 0; break;
      case "ulnone": cur.u = false; break;
      case "plain":
        cur.b = false; cur.i = false; cur.u = false; cur.fs = null; cur.color = null;
        break;
      case "pard": cur.align = "l"; break;
      case "ql": cur.align = "l"; break;
      case "qc": cur.align = "c"; break;
      case "qr": cur.align = "r"; break;
      case "qj": cur.align = "j"; break;
      case "fs": cur.fs = param; break;
      case "cf": cur.color = param; break;
      case "cb": case "highlight": break; // background color not rendered
      case "par": case "page": case "sect": newPara(); break;
      case "line": emit("\n"); break;
      case "tab": case "cell": case "nestcell": emit("\t"); break;
      case "row": case "nestrow": newPara(); break;
      case "uc": cur.uc = param !== null && param >= 0 ? param : 1; break;
      case "u":
        if (param !== null) {
          let cp = param;
          if (cp < 0) cp += 65536;
          emit(String.fromCharCode(cp));
          unicodeSkip = cur.uc;
        }
        break;
      case "ansicpg":
        if (param !== null && param !== 1252) {
          try { cpDecoder = new TextDecoder(`windows-${param}`); } catch { cpDecoder = null; }
        }
        break;
      case "red": cur.cr = param; break;
      case "green": cur.cg = param; break;
      case "blue": cur.cb = param; break;
      default:
        if (SYMBOL_WORDS[word] !== undefined) emit(SYMBOL_WORDS[word]);
        break;
    }
    return 0;
  };

  while (i < n) {
    const ch = s[i];
    if (ch === "{") {
      groups++;
      stack.push({ ...cur });
      i++;
    } else if (ch === "}") {
      if (stack.length) {
        const closing = cur;
        cur = stack.pop()!;
        // flush a pending colortbl entry when the group ends
        if (closing.inColortbl && (closing.cr !== null || closing.cg !== null || closing.cb !== null)) {
          const cr = closing.cr, cg = closing.cg, cb = closing.cb;
          if (cr !== null && cg !== null && cb !== null) colors.push(`rgb(${cr},${cg},${cb})`);
        }
      }
      i++;
    } else if (ch === "\\") {
      i++;
      if (i >= n) break;
      const c2 = s[i];
      if (c2 === "'") {
        // \'hh hex escape
        const hex = s.substr(i + 1, 2);
        i += 3;
        if (unicodeSkip > 0) {
          unicodeSkip--;
        } else if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          const code = parseInt(hex, 16);
          const dec = cpDecoder as TextDecoder | null;
          if (dec) {
            try { emit(dec.decode(new Uint8Array([code]))); } catch { emit(cp1252Char(code)); }
          } else {
            emit(cp1252Char(code));
          }
        }
      } else if (c2 === "*") {
        // ignorable destination — skip the whole group
        cur.skip = true;
        i++;
        if (s[i] === " ") i++;
      } else if (/[a-zA-Z]/.test(c2)) {
        let word = "";
        while (i < n && /[a-zA-Z]/.test(s[i])) { word += s[i]; i++; }
        let param: number | null = null;
        let neg = false;
        if (s[i] === "-") { neg = true; i++; }
        if (i < n && /[0-9]/.test(s[i])) {
          let d = "";
          while (i < n && /[0-9]/.test(s[i])) { d += s[i]; i++; }
          param = parseInt(d, 10) * (neg ? -1 : 1);
        }
        if (s[i] === " ") i++; // delimiter space
        const skipBytes = handleWord(word, param);
        if (skipBytes > 0) i += skipBytes;
      } else {
        // escaped symbol / control symbol
        i++;
        switch (c2) {
          case "\\": case "{": case "}": emit(c2); break;
          case "~": emit("\u00a0"); break;
          case "-": case "_": case ":": break; // optional hyphen etc.
          case "\n": case "\r": break;         // raw line breaks are not content
          default:
            if (c2 === "*") cur.skip = true;
            break;
        }
      }
    } else if (ch === "\n" || ch === "\r") {
      i++; // RTF source line breaks are ignored
    } else {
      // plain text run (batched for speed); \u substitutes may be literal chars
      let j = i;
      while (j < n) {
        const t = s[j];
        if (t === "\\" || t === "{" || t === "}" || t === "\n" || t === "\r") break;
        j++;
      }
      let chunk = s.slice(i, j);
      if (unicodeSkip > 0) {
        const eat = Math.min(unicodeSkip, chunk.length);
        chunk = chunk.slice(eat);
        unicodeSkip -= eat;
      }
      if (chunk) emit(chunk);
      i = j;
    }
  }

  // drop trailing empty paragraph
  while (paras.length > 1 && paras[paras.length - 1].runs.length === 0) paras.pop();
  return { paras, colors, stats: { chars, groups, colors: colors.length } };
}

/* ------------------------------ html generation ------------------------------ */

function escapeHtml(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rtfToHtml(result: RtfResult): string {
  const { paras, colors } = result;
  return paras
    .map((p) => {
      const align = p.align === "c" ? "center" : p.align === "r" ? "right" : p.align === "j" ? "justify" : "left";
      const inner = p.runs
        .map((r) => {
          const styles: string[] = [];
          if (r.b) styles.push("font-weight:700");
          if (r.i) styles.push("font-style:italic");
          if (r.u) styles.push("text-decoration:underline");
          if (r.fs !== null && r.fs > 0) styles.push(`font-size:${Math.max(8, Math.round((r.fs * 2) / 3))}px`);
          if (r.color !== null && r.color !== 0 && colors[r.color]) styles.push(`color:${colors[r.color]}`);
          const text = escapeHtml(r.text).replace(/\n/g, "<br/>");
          return styles.length ? `<span style="${styles.join(";")}">${text}</span>` : text;
        })
        .join("");
      return `<div style="text-align:${align}">${inner || "\u00a0"}</div>`;
    })
    .join("");
}

/* ------------------------------ component ------------------------------ */

export default function RtfViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [result, setResult] = React.useState<RtfResult | null>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"render" | "raw">("render");
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setResult(null);
      setHtml(null);
      setSource(null);
      setError(null);
      try {
        let bytes: Uint8Array;
        if (arrayBuffer) bytes = new Uint8Array(arrayBuffer);
        else if (head && head.length >= 5 && String.fromCharCode(...head.subarray(0, 5)) === "{\\rtf") bytes = head;
        else bytes = head;
        if (!bytes.length) throw new Error("empty file");
        const capped = bytes.subarray(0, Math.min(bytes.length, SOURCE_CAP));
        const src = new TextDecoder("windows-1252", { fatal: false }).decode(capped);
        if (!/^[\s{]*\\rtf/.test(src)) throw new Error("not an RTF document (missing \\rtf header)");
        if (cancelled) return;
        setSource(src);
        const parsed = parseRtf(src);
        if (cancelled) return;
        setResult(parsed);
        const DOMPurify = (await import("dompurify")).default;
        const clean = DOMPurify.sanitize(rtfToHtml(parsed), {
          FORBID_TAGS: ["script", "style", "iframe", "form", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
          ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        });
        if (cancelled) return;
        setHtml(clean);
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "The RTF structure could not be parsed. Very old or Word-generated RTF with unusual destinations may fail — try the raw view or hex view.",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, head]);

  if (error) return <ErrorCard title="Cannot parse this RTF document" message={error.message} hint={error.hint} />;

  if (!result) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">RTF</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Parsing RTF…" />
      </div>
    );
  }

  const exportHtml = () => {
    const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${fileName.replace(/</g, "&lt;")}</title>
<style>body{max-width:52rem;margin:2.5rem auto;padding:0 1rem;font-family:'Calibri',Georgia,serif;line-height:1.6;color:#222}div{margin:0.35em 0;white-space:pre-wrap}</style>
</head><body>${rtfToHtml(result)}</body></html>`;
    downloadBlob(page, fileName.replace(/\.\w+$/, "") + ".html", "text/html");
  };

  const hasContent = result.stats.chars > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">RTF</Chip>
            {hasContent ? <Chip><span className="inline-flex items-center gap-1"><Braces className="h-3 w-3" />{formatNum(result.stats.groups)} groups</span></Chip> : null}
            {hasContent ? <Chip>{formatNum(result.stats.chars)} chars</Chip> : null}
            {result.stats.colors > 1 ? <Chip tone="teal"><span className="inline-flex items-center gap-1"><Palette className="h-3 w-3" />{result.stats.colors} colors</span></Chip> : null}
          </>
        }
        center={
          <Segmented value={mode} onChange={(v) => setMode(v)} options={[{ value: "render", label: "Rendered" }, { value: "raw", label: "Source" }]} />
        }
        right={
          <>
            <ToolbarDivider />
            <ToolButton label="Export HTML" onClick={exportHtml} title="Download as styled HTML"><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />

      {mode === "render" ? (
        <ViewerBody className="flex justify-center bg-zinc-950/40">
          <div className="rtf-body w-full max-w-3xl px-6 py-8">
            {html === null ? (
              <div className="flex items-center gap-2 py-16 text-sm text-zinc-500">
                <FileText className="h-4 w-4 animate-pulse text-emerald-400" />
                Rendering…
              </div>
            ) : hasContent ? (
              <div className={cn(!html.trim() && "hidden")} dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 text-xs text-amber-300">
                No text runs were recovered from this document (only skipped destinations like
                font/style tables were found). Switch to “Source” to inspect the raw RTF.
              </div>
            )}
          </div>
        </ViewerBody>
      ) : (
        <ViewerBody>
          <pre className="whitespace-pre-wrap break-words px-6 py-8 font-mono text-[11.5px] leading-5 text-zinc-300">
            {source && source.length > 1_000_000
              ? source.slice(0, 1_000_000) + "\n\n[…truncated — showing first 1 MB of " + formatNum(source.length) + " chars]"
              : source}
          </pre>
        </ViewerBody>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        {mode === "render" ? <FileText className="h-3.5 w-3.5 shrink-0" /> : <Code2 className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{fileName}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          {formatBytes(file.size)} · {detected.name} · custom RTF parser
        </span>
      </div>

      <style>{`
        .rtf-body { color: #d4d4d8; font-family: 'Calibri', 'Segoe UI', Georgia, serif; font-size: 14.5px; line-height: 1.7; }
        .rtf-body > div { margin: 0.35em 0; white-space: pre-wrap; overflow-wrap: break-word; }
        .rtf-body span { white-space: pre-wrap; }
      `}</style>
    </div>
  );
}
