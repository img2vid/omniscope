"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState,
  ToolbarSelect, Chip, Field, InfoGrid,
} from "./viewer-ui";
import { shannonEntropy, byteHistogram, hexDumpLine, formatNum, toHex, humanBitsPerByte, clamp } from "@/lib/utils";
import { Search, Copy, Download, Zap, Binary, ChevronLeft, ChevronRight, MoveRight } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE = 4096; // bytes per page
const BYTES_PER_ROW = 16;

export default function HexViewer({ file, arrayBuffer, head, fileName }: ViewerProps) {
  const [page, setPage] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<{ offset: number; len: number; ascii: boolean }[] | null>(null);
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [entropy, setEntropy] = React.useState<number>(0);
  const [hist, setHist] = React.useState<Uint32Array | null>(null);
  const [jump, setJump] = React.useState("");
  const [err2, setErr2] = React.useState("");

  React.useEffect(() => {
    (async () => {
      try {
        const size = file.size;
        const want = page * PAGE;
        if (want < size) {
          const slice = await file.slice(want, Math.min(want + PAGE, size)).arrayBuffer();
          setBytes(new Uint8Array(slice));
        } else {
          setBytes(new Uint8Array(0));
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [file, page]);

  React.useEffect(() => {
    const src = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    setEntropy(shannonEntropy(src));
    setHist(byteHistogram(src));
  }, [arrayBuffer, head]);

  const totalPages = Math.max(1, Math.ceil(file.size / PAGE));
  const view = bytes ?? new Uint8Array(0);
  const base = page * PAGE;
  const rows: { offset: number; row: Uint8Array }[] = [];
  for (let i = 0; i < view.length; i += BYTES_PER_ROW) {
    rows.push({ offset: base + i, row: view.subarray(i, i + BYTES_PER_ROW) });
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    const src = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const out: { offset: number; len: number; ascii: boolean }[] = [];
    if (q.startsWith("hex:")) {
      const hex = q.slice(4).replace(/\s+/g, "");
      if (/^[0-9a-fA-F*]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 2) {
        const pat: (number | null)[] = [];
        for (let i = 0; i < hex.length; i += 2) {
          const pair = hex.slice(i, i + 2);
          pat.push(pair.includes("*") ? null : parseInt(pair, 16));
        }
        for (let i = 0; i + pat.length <= src.length && out.length < 200; i++) {
          let ok = true;
          for (let j = 0; j < pat.length; j++) {
            const want = pat[j];
            if (want !== null && src[i + j] !== want) { ok = false; break; }
          }
          if (ok) out.push({ offset: i, len: pat.length, ascii: false });
        }
      }
    } else {
      const needle = new TextEncoder().encode(q);
      outer: for (let i = 0; i + needle.length <= src.length; i++) {
        for (let j = 0; j < needle.length; j++) if (src[i + j] !== needle[j]) continue outer;
        out.push({ offset: i, len: needle.length, ascii: true });
        if (out.length >= 200) break;
      }
    }
    setSearchResults(out);
  }

  function gotoOffset(off: number) {
    const p = Math.floor(off / PAGE);
    setPage(clamp(p, 0, totalPages - 1));
  }

  if (err) return <ErrorCard title="Read failed" message={err} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <ToolButton disabled={page === 0} onClick={() => setPage(0)} title="First page"><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page"><ChevronLeft className="h-3.5 w-3.5 rotate-180" /></ToolButton>
            <span className="px-1 font-mono text-[11px] text-zinc-400">
              {formatNum(page + 1)} / {formatNum(totalPages)}
            </span>
            <ToolButton disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page"><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page"><ChevronRight className="h-3.5 w-3.5 rotate-180" /></ToolButton>
            <ToolbarDivider />
            <Chip tone="teal">{entropy.toFixed(2)} bits/byte</Chip>
            <Chip>{humanBitsPerByte(entropy)}</Chip>
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-sm items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search ASCII or hex: FF D8 ??"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
          </div>
        }
        right={
          <>
            <div className="flex h-7 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
              <MoveRight className="h-3.5 w-3.5 text-zinc-500" />
              <input
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = jump.trim().startsWith("0x") ? parseInt(jump.trim(), 16) : parseInt(jump.trim(), 10);
                    if (!Number.isNaN(v)) { gotoOffset(v); setErr2(""); } else setErr2("bad offset");
                  }
                }}
                placeholder="offset…"
                className="h-full w-20 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
              />
            </div>
            <ToolButton label="Copy page" onClick={() => {
              const dump = rows.map((r) => hexDumpLine(r.row, r.offset)).join("\n");
              navigator.clipboard?.writeText(dump);
            }}><Copy className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Dump" onClick={() => {
              const dump = rows.map((r) => hexDumpLine(r.row, r.offset)).join("\n");
              const blob = new Blob([dump], { type: "text/plain" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = fileName + ".hexdump.txt";
              a.click();
            }}><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />
      {searchResults ? (
        <div className="flex max-h-28 shrink-0 items-center gap-2 overflow-x-auto border-b border-zinc-800 bg-zinc-900/70 px-2 py-1.5 scrollbar-thin">
          <Chip tone="amber">{formatNum(searchResults.length)} hits</Chip>
          {searchResults.slice(0, 30).map((r, i) => (
            <button
              key={i}
              onClick={() => gotoOffset(r.offset)}
              className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-emerald-700 hover:text-emerald-300"
            >
              {r.ascii ? `"${new TextDecoder().decode((arrayBuffer ? new Uint8Array(arrayBuffer) : head).subarray(r.offset, r.offset + r.len)).replace(/[^\x20-\x7e]/g, ".")}"` : toHex((arrayBuffer ? new Uint8Array(arrayBuffer) : head).subarray(r.offset, r.offset + Math.min(4, r.len)))}
              <span className="text-zinc-600"> @{formatNum(r.offset)}</span>
            </button>
          ))}
          {searchResults.length === 0 ? <span className="text-[11px] text-zinc-500">No matches</span> : null}
        </div>
      ) : null}
      <ViewerBody className="p-3">
        {!bytes ? (
          <LoadingState label="Reading bytes…" />
        ) : (
          <div className="select-text font-mono text-[12px] leading-[19px]">
            {rows.map((r) => {
              const matchHere = searchResults?.some((s) => s.offset >= r.offset && s.offset < r.offset + BYTES_PER_ROW);
              return (
                <div
                  key={r.offset}
                  className={cn("flex gap-4 rounded px-1", matchHere ? "bg-amber-900/20" : "hover:bg-zinc-900/50")}
                >
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); }}
                    className="w-20 shrink-0 text-zinc-600"
                    title={`Offset ${r.offset} (0x${r.offset.toString(16)})`}
                  >
                    {r.offset.toString(16).padStart(8, "0")}
                  </a>
                  <span className="tracking-widest text-zinc-300">
                    {Array.from({ length: 16 }, (_, i) => {
                      const b = r.row[i];
                      const abs = r.offset + i;
                      const hit = searchResults?.find((s) => abs >= s.offset && abs < s.offset + s.len);
                      if (b === undefined) return <span key={i} className="text-zinc-800">·· </span>;
                      return (
                        <span key={i} className={cn(hit ? "bg-emerald-800/60 text-emerald-200" : "")}>
                          {b.toString(16).padStart(2, "0")}
                          {i === 7 ? "  " : " "}
                        </span>
                      );
                    })}
                  </span>
                  <span className="text-zinc-500">
                    {Array.from({ length: 16 }, (_, i) => {
                      const b = r.row[i];
                      if (b === undefined) return " ";
                      return <span key={i} className={cn(b >= 0x20 && b < 0x7f ? "" : "text-zinc-700")}>{b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."}</span>;
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ViewerBody>
      {/* byte distribution footer */}
      <div className="flex shrink-0 items-stretch gap-3 border-t border-zinc-800 bg-zinc-900/50 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Binary className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <div className="flex h-8 min-w-0 flex-1 items-end gap-px" aria-label="byte histogram">
            {hist ? Array.from({ length: 128 }, (_, i) => {
              const v = hist[i * 2] + hist[i * 2 + 1];
              const max = Math.max(...hist) || 1;
              return <div key={i} className="min-w-0 flex-1 rounded-t bg-emerald-800/80" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />;
            }) : null}
          </div>
          <InfoGrid className="hidden w-64 shrink-0 md:grid">
            <Field label="Range">0x00–0xFF</Field>
            <Field label="Entropy" mono>{entropy.toFixed(3)}</Field>
          </InfoGrid>
        </div>
      </div>
    </div>
  );
}
