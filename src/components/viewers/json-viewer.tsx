"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Segmented, Chip,
} from "./viewer-ui";
import { cn, formatBytes, formatNum, downloadBlob } from "@/lib/utils";
import { Braces, ChevronDown, ChevronRight, Search, Copy, Download, Brackets, Hash, Binary, Table } from "lucide-react";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function countNodes(v: Json): { nodes: number; depth: number; keys: number; arrays: number; objects: number } {
  let nodes = 1, keys = 0, arrays = 0, objects = 0;
  let depth = 1;
  if (Array.isArray(v)) {
    arrays++;
    let childDepth = 0;
    for (const c of v) {
      const r = countNodes(c);
      nodes += r.nodes; keys += r.keys; arrays += r.arrays; objects += r.objects;
      childDepth = Math.max(childDepth, r.depth);
    }
    depth += childDepth;
  } else if (v && typeof v === "object") {
    objects++;
    let childDepth = 0;
    for (const k of Object.keys(v)) {
      keys++;
      const r = countNodes(v[k]);
      nodes += r.nodes; keys += r.keys; arrays += r.arrays; objects += r.objects;
      childDepth = Math.max(childDepth, r.depth);
    }
    depth += childDepth;
  }
  return { nodes, depth, keys, arrays, objects };
}

const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** flatten one nesting level with dot notation for CSV export */
function flattenRow(row: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, Json>)) out[`${k}.${k2}`] = v2;
    } else {
      out[k] = v as Json;
    }
  }
  return out;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: unknown[]): string {
  const flat = rows.map((r) => flattenRow(r as Record<string, unknown>));
  const headers: string[] = [];
  for (const r of flat.slice(0, 2000)) {
    for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  }
  const lines = [headers.map(csvCell).join(",")];
  for (const r of flat) lines.push(headers.map((h) => csvCell(r[h])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export default function JsonViewer({ file, arrayBuffer, head, fileName }: ViewerProps) {
  const [parsed, setParsed] = React.useState<Json | null>(null);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [raw, setRaw] = React.useState<string>("");
  const [mode, setMode] = React.useState<"tree" | "raw">("tree");
  const [query, setQuery] = React.useState("");
  const [stats, setStats] = React.useState<ReturnType<typeof countNodes> | null>(null);
  const [collapsedAll, setCollapsedAll] = React.useState(false);
  const [jsonlMode, setJsonlMode] = React.useState(false);

  React.useEffect(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const src = bytes.subarray(0, MAX_JSON_BYTES);
    let text = new TextDecoder("utf-8", { fatal: false }).decode(src);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    setRaw(text);
    try {
      const val = JSON.parse(text);
      setParsed(val);
      setStats(countNodes(val));
    } catch {
      // try JSONL / JSON5-ish
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const allJson = lines.length > 1 && lines.every((l) => { try { JSON.parse(l); return true; } catch { return false; } });
      if (allJson) {
        const arr = lines.map((l) => JSON.parse(l));
        setParsed(arr);
        setStats(countNodes(arr));
        setJsonlMode(true);
      } else {
        try {
          // JSON5 light: strip comments & trailing commas
          const cleaned = text
            .replace(/\/\/[^\n]*/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/,\s*([}\]])/g, "$1");
          const val = JSON.parse(cleaned);
          setParsed(val);
          setStats(countNodes(val));
        } catch (e) {
          setParseError(e instanceof Error ? e.message : String(e));
        }
      }
    }
  }, [arrayBuffer, head]);

  const filterText = query.trim().toLowerCase();

  const matches = React.useMemo(() => {
    if (!parsed || !filterText) return new Set<string>();
    const out = new Set<string>();
    const walk = (v: Json, path: string) => {
      if (typeof v === "string") { if (v.toLowerCase().includes(filterText)) out.add(path); }
      else if (typeof v === "number" || typeof v === "boolean") { if (String(v).includes(filterText)) out.add(path); }
      else if (Array.isArray(v)) v.forEach((c, i) => walk(c, `${path}/${i}`));
      else if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          if (k.toLowerCase().includes(filterText)) out.add(path);
          walk(val, `${path}/${k}`);
        }
      }
    };
    walk(parsed, "");
    return out;
  }, [filterText, parsed]);

  const pretty = React.useMemo(() => {
    try { return JSON.stringify(parsed, null, 2); } catch { return raw; }
  }, [parsed, raw]);

  /** CSV export is offered when the root is an array of (mostly) flat objects */
  const csvReady = React.useMemo(() => {
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    let objects = 0;
    for (const r of parsed.slice(0, 50)) {
      if (r && typeof r === "object" && !Array.isArray(r)) objects++;
    }
    return objects >= Math.min(parsed.length, 50) - 1; // tolerate a couple of oddballs
  }, [parsed]);

  if (parseError) {
    return (
      <ErrorCard
        title="Invalid JSON"
        message={parseError}
        hint="The file was detected as JSON-like. You can still inspect raw bytes via the viewer switcher."
      />
    );
  }
  if (!parsed) return <LoadingState label="Parsing JSON…" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{jsonlMode ? "JSON Lines" : "JSON"}</Chip>
            {stats ? <Chip>{formatNum(stats.nodes)} nodes</Chip> : null}
            {stats ? <Chip>depth {stats.depth}</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-sm items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keys & values…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {filterText ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{matches.size} hit(s)</span> : null}
          </div>
        }
        right={
          <>
            <Segmented value={mode} onChange={setMode} options={[{ value: "tree", label: "Tree" }, { value: "raw", label: "Formatted" }]} />
            <ToolbarDivider />
            <ToolButton label="Collapse" onClick={() => setCollapsedAll((v) => !v)}><Binary className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Copy" onClick={() => navigator.clipboard?.writeText(pretty)}><Copy className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Minified" onClick={() => downloadBlob(new Blob([JSON.stringify(parsed)], { type: "application/json" }), fileName.replace(/\.\w+$/, "") + ".min.json")}><Download className="h-3.5 w-3.5" /></ToolButton>
            {csvReady ? (
              <ToolButton
                label="CSV"
                title="Export the object array as CSV (dot-notation for nested fields)"
                onClick={() => downloadBlob(new Blob([rowsToCsv(parsed as unknown[])], { type: "text/csv;charset=utf-8" }), fileName.replace(/\.\w+$/, "") + ".csv")}
              >
                <Table className="h-3.5 w-3.5" />
              </ToolButton>
            ) : null}
          </>
        }
      />
      <ViewerBody className="p-3 font-mono text-[12.5px] leading-5">
        {mode === "raw" ? (
          <pre className="whitespace-pre-wrap break-words text-zinc-300">{pretty}</pre>
        ) : (
          <JsonNode
            value={parsed}
            name=""
            path=""
            defaultOpen
            collapsedAll={collapsedAll}
            matches={matches}
            isRoot
          />
        )}
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Braces className="h-3.5 w-3.5" />
        {stats ? (
          <>
            <span>{formatNum(stats.keys)} keys</span>
            <span>· {formatNum(stats.objects)} objects</span>
            <span>· {formatNum(stats.arrays)} arrays</span>
          </>
        ) : null}
        <span className="ml-auto">{formatBytes(file.size)}</span>
      </div>
    </div>
  );
}

function JsonNode({
  value, name, path, defaultOpen, collapsedAll, matches, isRoot,
}: {
  value: Json; name: string; path: string; defaultOpen: boolean;
  collapsedAll: boolean; matches: Set<string>; isRoot?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen && !collapsedAll);
  React.useEffect(() => setOpen(defaultOpen && !collapsedAll), [collapsedAll, defaultOpen]);

  const isArray = Array.isArray(value);
  const isObject = !isArray && value !== null && typeof value === "object";
  const hasChildren = isArray || isObject;
  const childCount = isArray ? value.length : isObject ? Object.keys(value).length : 0;
  const isMatch = matches.has(path);
  const matchedChild = React.useMemo(() => {
    if (!matches.size) return false;
    for (const m of matches) if (m.startsWith(path === "" ? "/" : path + "/") && m !== path) return true;
    return false;
  }, [matches, path]);
  const effectiveOpen = open || matchedChild;

  const valueColor =
    typeof value === "string" ? "text-amber-300" :
    typeof value === "number" ? "text-rose-300" :
    typeof value === "boolean" ? "text-violet-300" :
    value === null ? "text-zinc-500 italic" : "text-zinc-300";

  function valPreview(v: Json): string {
    if (typeof v === "string") return `"${v.length > 42 ? v.slice(0, 42) + "…" : v}"`;
    if (Array.isArray(v)) return `[${v.length}]`;
    if (v && typeof v === "object") return `{${Object.keys(v).length}}`;
    return String(v);
  }

  return (
    <div className="ml-0">
      <div className={cn("flex items-start gap-1 rounded px-0.5", (isMatch) && "bg-amber-900/25")}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={effectiveOpen ? "Collapse" : "Expand"}
          >
            {effectiveOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        {name !== "" && (
          <span className="shrink-0 text-emerald-300">{name}<span className="text-zinc-600">:</span>&nbsp;</span>
        )}
        {hasChildren ? (
          <>
            <span className="text-zinc-500">{isArray ? <Brackets className="inline h-3 w-3" /> : <Hash className="inline h-3 w-3" />}</span>
            <span className="text-zinc-500">{isArray ? `[${childCount}]` : `{${childCount}}`}</span>
            {!effectiveOpen && childCount > 0 ? (
              <span className="ml-1 text-zinc-600">{valPreview(value as Json[] | Record<string, Json>)}</span>
            ) : null}
            <span className="ml-auto text-zinc-700">{}</span>
          </>
        ) : (
          <span className={cn("min-w-0 break-all", valueColor)}>
            {typeof value === "string" ? `"${value}"` : String(value)}
          </span>
        )}
        {isRoot && hasChildren ? null : <span className="text-zinc-700">,</span>}
      </div>
      {hasChildren && effectiveOpen ? (
        <div className="ml-5 border-l border-zinc-800/80 pl-2">
          {isArray
            ? (value as Json[]).map((v, i) => (
                <JsonNode key={i} value={v} name={String(i)} path={`${path}/${i}`} defaultOpen={false} collapsedAll={collapsedAll} matches={matches} />
              ))
            : Object.entries(value as Record<string, Json>).map(([k, v]) => (
                <JsonNode key={k} value={v} name={k} path={`${path}/${k}`} defaultOpen={false} collapsedAll={collapsedAll} matches={matches} />
              ))}
        </div>
      ) : null}
    </div>
  );
}
