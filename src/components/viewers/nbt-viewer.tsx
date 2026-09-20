"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip,
  SectionCard, InfoGrid, Field, EmptyHint, Segmented,
} from "./viewer-ui";
import { cn, formatBytes, formatNum, downloadBlob } from "@/lib/utils";
import { DataReader } from "@/lib/binary";
import {
  Boxes, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, Copy, Check,
  Download, BarChart3, Package,
} from "lucide-react";

/* ============================== NBT model & parser ============================== */

const MAX_DEPTH = 64;            // recursion depth cap
const MAX_NODES = 200000;        // total tag cap
const MAX_PAYLOAD = 512 * 1024 * 1024; // decompressed size guard
const ROW_LIMIT = 20000;         // walk cap while flattening rows
const ROW_CAP = 2000;            // rendered row cap when the tree overflows
const STR_PREVIEW = 200;
const ARR_PREVIEW = 8;
const ARR_EXPANDED = 64;
const JSON_ARRAY_LIMIT = 32;

const NOT_NBT = "Not a recognized NBT payload";

const TAG_NAME = [
  "End", "Byte", "Short", "Int", "Long", "Float", "Double",
  "ByteArray", "String", "List", "Compound", "IntArray", "LongArray",
];

interface NbtNode {
  name: string;
  type: number; // 1..12
  start: number; // byte offset in the decompressed payload
  num?: number | bigint;   // types 1–6
  str?: string;            // type 8
  bytes?: Uint8Array;      // type 7 (signed values displayed)
  ints?: Int32Array;       // type 11
  longs?: BigInt64Array;   // type 12
  children?: NbtNode[];    // types 9, 10
  listType?: number;       // type 9 element type
}

interface NbtDoc {
  root: NbtNode;
  rootName: string;
  rootEnd: number;
  totalNodes: number;
  maxDepth: number; // edges below root; levels = maxDepth + 1
  histogram: number[];
}

class ParseCtx {
  r: DataReader;
  nodes = 0;
  maxDepth = 0;
  histogram = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor(r: DataReader) { this.r = r; }

  bump(type: number, depth: number) {
    if (++this.nodes > MAX_NODES) {
      throw new Error(`Node cap exceeded (${formatNum(MAX_NODES)} tags) — payload may be malformed`);
    }
    if (depth > MAX_DEPTH) {
      throw new Error(`Nesting deeper than ${MAX_DEPTH} levels — payload may be malformed`);
    }
    if (depth > this.maxDepth) this.maxDepth = depth;
    this.histogram[type]++;
  }
}

/**
 * Modified UTF-8 (Java DataOutput flavor) decoder that also accepts standard
 * UTF-8 4-byte sequences: handles 0xC0 0x80 NUL, CESU-8 surrogate pairs and
 * replaces stray surrogates / invalid bytes with U+FFFD.
 */
function decodeNbtString(bytes: Uint8Array): string {
  const units: number[] = [];
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const c = bytes[i];
    if (c < 0x80 && c !== 0) { units.push(c); i += 1; continue; }
    if ((c & 0xe0) === 0xc0 && i + 1 < n && (bytes[i + 1] & 0xc0) === 0x80) {
      units.push(((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
      continue;
    }
    if ((c & 0xf0) === 0xe0 && i + 2 < n && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80) {
      units.push(((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
      continue;
    }
    if ((c & 0xf8) === 0xf0 && i + 3 < n && (bytes[i + 1] & 0xc0) === 0x80 && (bytes[i + 2] & 0xc0) === 0x80 && (bytes[i + 3] & 0xc0) === 0x80) {
      // standard UTF-8 supplementary plane → surrogate pair
      const cp = ((c & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const v = cp - 0x10000;
      units.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
      continue;
    }
    units.push(0xfffd);
    i += 1;
  }
  let out = "";
  for (let j = 0; j < units.length; j++) {
    const u = units[j];
    if (u >= 0xd800 && u <= 0xdbff) {
      const v = j + 1 < units.length ? units[j + 1] : 0;
      if (v >= 0xdc00 && v <= 0xdfff) { out += String.fromCharCode(u, v); j++; continue; }
      out += "\uFFFD";
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += String.fromCharCode(u);
    }
  }
  return out;
}

function readNbtString(ctx: ParseCtx): string {
  const r = ctx.r;
  if (!r.has(2)) throw new Error("Truncated NBT: string length missing");
  const len = r.u16();
  if (!r.has(len)) throw new Error(`Truncated NBT: string of ${len} bytes extends beyond payload`);
  return decodeNbtString(r.bytesOf(len));
}

function readNode(ctx: ParseCtx, name: string, type: number, depth: number): NbtNode {
  const r = ctx.r;
  const start = r.offset;
  ctx.bump(type, depth);
  const node: NbtNode = { name, type, start };

  switch (type) {
    case 1:
      if (!r.has(1)) throw new Error("Truncated NBT: TAG_Byte payload missing");
      node.num = r.i8();
      break;
    case 2:
      if (!r.has(2)) throw new Error("Truncated NBT: TAG_Short payload missing");
      node.num = r.i16();
      break;
    case 3:
      if (!r.has(4)) throw new Error("Truncated NBT: TAG_Int payload missing");
      node.num = r.i32();
      break;
    case 4:
      if (!r.has(8)) throw new Error("Truncated NBT: TAG_Long payload missing");
      node.num = r.i64();
      break;
    case 5:
      if (!r.has(4)) throw new Error("Truncated NBT: TAG_Float payload missing");
      node.num = r.f32();
      break;
    case 6:
      if (!r.has(8)) throw new Error("Truncated NBT: TAG_Double payload missing");
      node.num = r.f64();
      break;
    case 7: {
      if (!r.has(4)) throw new Error("Truncated NBT: TAG_ByteArray length missing");
      const len = r.i32();
      if (len < 0) throw new Error("TAG_ByteArray with negative length");
      if (!r.has(len)) throw new Error(`Truncated NBT: TAG_ByteArray of ${len} bytes extends beyond payload`);
      node.bytes = r.bytesOf(len);
      break;
    }
    case 8:
      node.str = readNbtString(ctx);
      break;
    case 9: {
      if (!r.has(5)) throw new Error("Truncated NBT: TAG_List header missing");
      const elemType = r.u8();
      if (elemType > 12) throw new Error(`TAG_List of unknown element type ${elemType}`);
      const len = r.i32();
      if (len < 0) throw new Error("TAG_List with negative length");
      if (len > 0 && elemType === 0) throw new Error("Non-empty TAG_List of TAG_End");
      if (len > r.remaining) throw new Error("TAG_List length exceeds remaining payload");
      node.listType = elemType;
      node.children = [];
      for (let i = 0; i < len; i++) node.children.push(readNode(ctx, "", elemType, depth + 1));
      break;
    }
    case 10: {
      node.children = [];
      for (;;) {
        if (!r.has(1)) throw new Error("Truncated NBT: TAG_Compound missing TAG_End");
        const t = r.u8();
        if (t === 0) break;
        if (t > 12) throw new Error(`Unknown tag type ${t} inside compound`);
        const childName = readNbtString(ctx);
        node.children.push(readNode(ctx, childName, t, depth + 1));
      }
      break;
    }
    case 11: {
      if (!r.has(4)) throw new Error("Truncated NBT: TAG_IntArray length missing");
      const len = r.i32();
      if (len < 0) throw new Error("TAG_IntArray with negative length");
      if (!r.has(len * 4)) throw new Error(`Truncated NBT: TAG_IntArray of ${len} ints extends beyond payload`);
      const ints = new Int32Array(len);
      for (let i = 0; i < len; i++) ints[i] = r.i32();
      node.ints = ints;
      break;
    }
    case 12: {
      if (!r.has(4)) throw new Error("Truncated NBT: TAG_LongArray length missing");
      const len = r.i32();
      if (len < 0) throw new Error("TAG_LongArray with negative length");
      if (!r.has(len * 8)) throw new Error(`Truncated NBT: TAG_LongArray of ${len} longs extends beyond payload`);
      const longs = new BigInt64Array(len);
      for (let i = 0; i < len; i++) longs[i] = r.i64();
      node.longs = longs;
      break;
    }
    default:
      throw new Error(`Unknown tag type ${type}`);
  }
  return node;
}

/** Parse a raw (decompressed) big-endian NBT payload. */
function parseNbt(payload: Uint8Array): NbtDoc {
  const ctx = new ParseCtx(new DataReader(payload, false));
  const r = ctx.r;
  if (!r.has(3)) throw new Error("Payload too short to contain an NBT root");
  const rootType = r.u8();
  if (rootType === 0 || rootType > 12) throw new Error(`Invalid root tag type ${rootType}`);
  const rootName = readNbtString(ctx);
  const root = readNode(ctx, rootName, rootType, 0);
  return {
    root,
    rootName,
    rootEnd: r.offset,
    totalNodes: ctx.nodes,
    maxDepth: ctx.maxDepth,
    histogram: ctx.histogram,
  };
}

/* ============================== JSON conversion ============================== */

function nbtToJson(node: NbtNode): unknown {
  switch (node.type) {
    case 1:
    case 2:
    case 3:
    case 5:
    case 6: {
      const v = node.num as number;
      return Number.isFinite(v) ? v : String(v);
    }
    case 4:
      return (node.num as bigint).toString();
    case 8:
      return node.str ?? "";
    case 7: {
      const b = node.bytes ?? new Uint8Array(0);
      const out: unknown[] = [];
      for (let i = 0; i < b.length && i < JSON_ARRAY_LIMIT; i++) out.push(b[i] > 127 ? b[i] - 256 : b[i]);
      if (b.length > JSON_ARRAY_LIMIT) out.push(`… +${b.length - JSON_ARRAY_LIMIT} more values`);
      return out;
    }
    case 11: {
      const ints = node.ints ?? new Int32Array(0);
      const out: unknown[] = [];
      for (let i = 0; i < ints.length && i < JSON_ARRAY_LIMIT; i++) out.push(ints[i]);
      if (ints.length > JSON_ARRAY_LIMIT) out.push(`… +${ints.length - JSON_ARRAY_LIMIT} more values`);
      return out;
    }
    case 12: {
      const longs = node.longs ?? new BigInt64Array(0);
      const out: unknown[] = [];
      for (let i = 0; i < longs.length && i < JSON_ARRAY_LIMIT; i++) out.push((longs[i] as bigint).toString());
      if (longs.length > JSON_ARRAY_LIMIT) out.push(`… +${longs.length - JSON_ARRAY_LIMIT} more values`);
      return out;
    }
    case 9:
      return (node.children ?? []).map((c) => nbtToJson(c));
    case 10: {
      const obj: Record<string, unknown> = {};
      const seen = new Map<string, number>();
      for (const c of node.children ?? []) {
        const n = seen.get(c.name) ?? 0;
        seen.set(c.name, n + 1);
        obj[n === 0 ? c.name : `${c.name} #${n + 1}`] = nbtToJson(c);
      }
      return obj;
    }
    default:
      return null;
  }
}

/* ============================== tree flattening & search ============================== */

interface Row {
  node: NbtNode;
  path: string;
  depth: number;
  idx: number;
  hasKids: boolean;
  expanded: boolean;
  isMatch: boolean;
  parentIsList: boolean;
}

function childPath(path: string, i: number): string {
  return path === "" ? String(i) : `${path}/${i}`;
}

function computeMatches(root: NbtNode, q: string): { matchPaths: Set<string>; expandSet: Set<string>; count: number } {
  const matchPaths = new Set<string>();
  const expandSet = new Set<string>();
  let count = 0;
  const walk = (node: NbtNode, path: string): boolean => {
    const nameHit = node.name.toLowerCase().includes(q);
    const strHit = node.type === 8 && (node.str ?? "").toLowerCase().includes(q);
    let desc = false;
    const kids = node.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      if (walk(kids[i], childPath(path, i))) desc = true;
    }
    if (nameHit || strHit) { matchPaths.add(path); count++; }
    if (desc) expandSet.add(path);
    return nameHit || strHit || desc;
  };
  walk(root, "");
  return { matchPaths, expandSet, count };
}

function buildRows(
  root: NbtNode,
  expandedPaths: Set<string>,
  forceAll: boolean,
  expandSet: Set<string>,
  matchPaths: Set<string>,
  filtering: boolean,
): { rows: Row[]; truncated: boolean } {
  const rows: Row[] = [];
  let truncated = false;

  const walk = (node: NbtNode, path: string, depth: number, idx: number, parentIsList: boolean) => {
    if (rows.length >= ROW_LIMIT) { truncated = true; return; }
    const isMatch = matchPaths.has(path);
    const hasMatchDesc = expandSet.has(path);
    if (filtering && !isMatch && !hasMatchDesc) return; // filter out non-matching subtrees
    const kids = node.children ?? [];
    const hasKids = kids.length > 0;
    const open = hasKids && (expandSet.has(path) || expandedPaths.has(path) || (!filtering && forceAll));
    rows.push({ node, path, depth, idx, hasKids, expanded: open, isMatch, parentIsList });
    if (hasKids && open) {
      const childIsList = node.type === 9;
      for (let i = 0; i < kids.length; i++) {
        walk(kids[i], childPath(path, i), depth + 1, i, childIsList);
      }
    }
  };

  walk(root, "", 0, 0, false);
  return { rows, truncated };
}

/* ============================== display helpers ============================== */

function tagTone(type: number): "amber" | "emerald" | "zinc" | "teal" | "rose" {
  if (type === 4) return "rose"; // Long
  if (type === 8) return "emerald"; // String
  if (type === 7 || type === 11 || type === 12) return "teal"; // arrays
  if (type === 9 || type === 10 || type === 0) return "zinc"; // containers
  return "amber"; // Byte/Short/Int/Float/Double
}

function tagBarColor(type: number): string {
  if (type === 4) return "bg-rose-500/70";
  if (type === 8) return "bg-emerald-500/70";
  if (type === 7 || type === 11 || type === 12) return "bg-teal-500/70";
  if (type === 9 || type === 10) return "bg-zinc-500/70";
  return "bg-amber-500/70";
}

function fmtFloat(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity";
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(parseFloat(v.toPrecision(7)));
}

function arrLen(node: NbtNode): number {
  if (node.type === 7) return node.bytes ? node.bytes.length : 0;
  if (node.type === 11) return node.ints ? node.ints.length : 0;
  return node.longs ? node.longs.length : 0;
}

function arrElem(node: NbtNode, i: number): string {
  if (node.type === 7) {
    const b = node.bytes ? node.bytes[i] : 0;
    return String(b > 127 ? b - 256 : b);
  }
  if (node.type === 11) return formatNum(node.ints ? node.ints[i] : 0);
  return (node.longs ? node.longs[i] : BigInt(0)).toLocaleString("en-US") + "L";
}

/* ============================== component ============================== */

type ViewState =
  | { status: "loading" }
  | { status: "error"; message: string; notNbt: boolean }
  | { status: "ok"; doc: NbtDoc; compression: "gzip" | "raw"; payloadSize: number };

export default function NbtViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [state, setState] = React.useState<ViewState>({ status: "loading" });
  const [panel, setPanel] = React.useState<"tree" | "stats">("tree");
  const [query, setQuery] = React.useState("");
  const [expandedPaths, setExpandedPaths] = React.useState<Set<string>>(() => new Set([""]));
  const [forceAll, setForceAll] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!arrayBuffer) return;
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const raw = new Uint8Array(arrayBuffer);
        let payload: Uint8Array;
        let compression: "gzip" | "raw" = "raw";
        if (head[0] === 0x1f && head[1] === 0x8b) {
          const { gunzipSync } = await import("fflate");
          const out = gunzipSync(raw);
          if (out.length > MAX_PAYLOAD) {
            throw new Error(`Decompressed payload too large (${formatBytes(out.length)} > ${formatBytes(MAX_PAYLOAD)})`);
          }
          payload = out;
          compression = "gzip";
        } else if (head[0] === 0x0a && head[1] === 0x00 && head[2] === 0x00) {
          payload = raw;
        } else {
          throw new Error(NOT_NBT);
        }
        const doc = parseNbt(payload);
        if (!cancelled) setState({ status: "ok", doc, compression, payloadSize: payload.length });
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setState({ status: "error", message, notNbt: message === NOT_NBT });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, head]);

  const ok = state.status === "ok" ? state : null;
  const filtering = query.trim() !== "";

  const matches = React.useMemo(
    () => (ok && filtering ? computeMatches(ok.doc.root, query.trim().toLowerCase()) : { matchPaths: new Set<string>(), expandSet: new Set<string>(), count: 0 }),
    [ok, filtering, query],
  );

  const rowsInfo = React.useMemo(
    () => (ok ? buildRows(ok.doc.root, expandedPaths, forceAll, matches.expandSet, matches.matchPaths, filtering) : { rows: [] as Row[], truncated: false }),
    [ok, expandedPaths, forceAll, matches, filtering],
  );

  const jsonText = React.useMemo(() => {
    if (!ok) return "";
    try {
      const value = nbtToJson(ok.doc.root);
      const wrapped = ok.doc.rootName !== "" ? { [ok.doc.rootName]: value } : value;
      return JSON.stringify(wrapped, null, 2);
    } catch {
      return "";
    }
  }, [ok]);

  if (!arrayBuffer) {
    return (
      <ErrorCard
        title="File too large for NBT parsing"
        message={`${fileName} exceeds the 96 MB in-memory buffer, so its payload can’t be decompressed and parsed here.`}
        hint="Use the Hex viewer to inspect the header, or open a smaller copy of the file (NBT payloads are usually far below the cap)."
      />
    );
  }
  if (state.status === "error") {
    return state.notNbt ? (
      <ErrorCard
        title="Not a recognized NBT payload"
        message="The file does not start with a gzip stream (1F 8B) or a raw anonymous TAG_Compound root (0A 00 00)."
        hint={
          <>
            Minecraft region files (<span className="font-mono">.mca</span>) wrap chunks in a custom container — try the Hex
            viewer for those. Bedrock little-endian NBT is not supported.
          </>
        }
      />
    ) : (
      <ErrorCard
        title="Could not parse NBT"
        message={state.message}
        hint="The payload may be corrupt, truncated, or a non-standard variant — the Hex viewer shows the raw bytes."
      />
    );
  }
  if (!ok) return <LoadingState label="Decompressing & parsing NBT…" />;

  const visibleRows = rowsInfo.truncated ? rowsInfo.rows.slice(0, ROW_CAP) : rowsInfo.rows;
  const doc = ok.doc;
  const trailing = ok.payloadSize - doc.rootEnd;
  const gzipRatio = ok.compression === "gzip" && file.size > 0 ? ok.payloadSize / file.size : null;

  function toggle(path: string) {
    setForceAll(false);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function expandAll() {
    setForceAll(true);
    setExpandedPaths(new Set());
  }
  function collapseAll() {
    setForceAll(false);
    setExpandedPaths(new Set());
  }
  function copyJson() {
    if (!jsonText) return;
    navigator.clipboard?.writeText(jsonText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }
  function exportJson() {
    if (!jsonText) return;
    const base = fileName.replace(/\.\w+$/, "") || "nbt";
    downloadBlob(jsonText, `${base}.json`, "application/json");
  }

  const histEntries: { type: number; count: number }[] = [];
  for (let t = 1; t <= 12; t++) if (doc.histogram[t] > 0) histEntries.push({ type: t, count: doc.histogram[t] });
  const maxCount = histEntries.reduce((m, e) => Math.max(m, e.count), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Boxes className="h-3 w-3" />NBT</Chip>
            <Chip tone={ok.compression === "gzip" ? "teal" : "zinc"}>{ok.compression === "gzip" ? "gzip" : "raw"}</Chip>
            <Chip>{formatNum(doc.totalNodes)} tags</Chip>
            <Chip>depth {formatNum(doc.maxDepth + 1)}</Chip>
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-sm items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tag names & strings…"
              aria-label="Search tags"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {filtering ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{matches.count} hit(s)</span> : null}
          </div>
        }
        right={
          <>
            <Segmented value={panel} onChange={setPanel} options={[{ value: "tree", label: "Tree" }, { value: "stats", label: "Stats" }]} />
            <ToolbarDivider />
            <ToolButton label="Expand all" onClick={expandAll} title="Expand every branch">
              <ChevronsDownUp className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Collapse all" onClick={collapseAll} title="Collapse to the root">
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Copy JSON" onClick={copyJson} disabled={!jsonText} title="Copy the tree converted to JSON">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton label="Download" onClick={exportJson} disabled={!jsonText} title="Download the tree as JSON">
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />

      <ViewerBody className={panel === "tree" ? "p-2 font-mono text-[12px] leading-5" : "p-4"}>
        {panel === "tree" ? (
          <div className="mx-auto max-w-5xl">
            {visibleRows.length === 0 ? (
              <EmptyHint>No tag names or string values match “{query.trim()}”.</EmptyHint>
            ) : (
              <>
                {visibleRows.map((row) => (
                  <NbtRow key={row.path} row={row} onToggle={toggle} />
                ))}
                {rowsInfo.truncated ? (
                  <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 px-3 py-2 font-sans text-[11px] leading-relaxed text-amber-300">
                    … truncated — this view would render more than {formatNum(ROW_LIMIT)} rows, so only the first{" "}
                    {formatNum(ROW_CAP)} are shown. Collapse branches, search, or export JSON to reach the rest.
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <SectionCard title="Root" icon={<Boxes className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Root name" mono>
                  {doc.rootName === "" ? <span className="italic text-zinc-500">“” — anonymous (modern NBT)</span> : doc.rootName}
                </Field>
                <Field label="Root type">{TAG_NAME[doc.root.type]}{doc.root.type === 9 ? ` of ${TAG_NAME[doc.root.listType ?? 0]}` : ""}</Field>
                <Field label="Total tags">{formatNum(doc.totalNodes)}</Field>
                <Field label="Max depth">{formatNum(doc.maxDepth + 1)} levels</Field>
                <Field label="Bytes consumed" mono>{formatNum(doc.rootEnd)} / {formatNum(ok.payloadSize)} B</Field>
              </InfoGrid>
              {trailing > 0 ? (
                <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300">
                  {formatNum(trailing)} trailing bytes after the root tag — extra data or appended members not part of the NBT tree.
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              title="Payload"
              icon={<Package className="h-3.5 w-3.5" />}
              right={<Chip tone={ok.compression === "gzip" ? "teal" : "zinc"}>{ok.compression === "gzip" ? "gzip" : "raw"}</Chip>}
            >
              <InfoGrid>
                <Field label="File size">{formatBytes(file.size)} ({formatNum(file.size)} B)</Field>
                {ok.compression === "gzip" ? (
                  <>
                    <Field label="Decompressed">{formatBytes(ok.payloadSize)} ({formatNum(ok.payloadSize)} B)</Field>
                    <Field label="Gzip ratio">
                      {gzipRatio ? `×${gzipRatio.toFixed(1)} expansion (${((file.size / ok.payloadSize) * 100).toFixed(1)}% of original)` : "—"}
                    </Field>
                  </>
                ) : (
                  <Field label="Encoding">uncompressed NBT</Field>
                )}
                <Field label="Byte order">big-endian</Field>
                <Field label="Name encoding">modified UTF-8</Field>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Tag histogram" icon={<BarChart3 className="h-3.5 w-3.5" />}>
              {histEntries.length === 0 ? (
                <EmptyHint>No tags.</EmptyHint>
              ) : (
                <div className="space-y-1.5">
                  {histEntries.map((e) => (
                    <div key={e.type} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-[11px] text-zinc-400">{TAG_NAME[e.type]}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-sm bg-zinc-800/80">
                        <div
                          className={cn("h-full rounded-sm", tagBarColor(e.type))}
                          style={{ width: `${Math.max(1, (e.count / maxCount) * 100)}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right tabular-nums text-[11px] text-zinc-400">{formatNum(e.count)}</span>
                      <span className="w-10 shrink-0 text-right tabular-nums text-[10px] text-zinc-700">
                        {((e.count / doc.totalNodes) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </ViewerBody>

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Boxes className="h-3.5 w-3.5" />
        <span className="truncate">
          {detected.name} · {formatNum(doc.totalNodes)} tags · {formatBytes(file.size)}
          {ok.compression === "gzip" ? ` → ${formatBytes(ok.payloadSize)} unpacked` : ""} · {fileName}
        </span>
      </div>
    </div>
  );
}

/* ============================== tree row ============================== */

function NbtRow({ row, onToggle }: { row: Row; onToggle: (path: string) => void }) {
  const node = row.node;
  const [strOpen, setStrOpen] = React.useState(false);
  const [arrOpen, setArrOpen] = React.useState(false);
  const isRoot = row.depth === 0;

  let nameEl: React.ReactNode;
  if (isRoot) {
    nameEl = (
      <span className={cn("shrink-0 font-semibold", node.name ? "text-emerald-300" : "italic text-zinc-500")}>
        {node.name || "(root)"}
      </span>
    );
  } else if (row.parentIsList) {
    nameEl = <span className="shrink-0 text-zinc-600">[{row.idx}]</span>;
  } else {
    nameEl = (
      <span className="max-w-[260px] shrink-0 truncate font-medium text-emerald-300" title={node.name}>
        {node.name}
      </span>
    );
  }

  return (
    <div
      className={cn("flex items-start gap-1.5 rounded px-1 py-px hover:bg-zinc-900/60", row.isMatch && "bg-amber-900/30")}
      style={{ paddingLeft: row.depth * 14 + 2 }}
    >
      {row.hasKids ? (
        <button
          type="button"
          onClick={() => onToggle(row.path)}
          aria-label={row.expanded ? `Collapse ${node.name || TAG_NAME[node.type]}` : `Expand ${node.name || TAG_NAME[node.type]}`}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
        >
          {row.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      ) : (
        <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      {nameEl}
      <Chip tone={tagTone(node.type)} className="shrink-0">{TAG_NAME[node.type]}</Chip>
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <NodeValue
          node={node}
          strOpen={strOpen}
          arrOpen={arrOpen}
          onStr={() => setStrOpen((v) => !v)}
          onArr={() => setArrOpen((v) => !v)}
        />
      </div>
      <span
        className="ml-auto hidden shrink-0 self-center text-[10px] tabular-nums text-zinc-700 sm:inline"
        title="Byte offset in the decompressed NBT payload"
      >
        0x{node.start.toString(16).padStart(4, "0")}
      </span>
    </div>
  );
}

function NodeValue({
  node, strOpen, arrOpen, onStr, onArr,
}: {
  node: NbtNode;
  strOpen: boolean;
  arrOpen: boolean;
  onStr: () => void;
  onArr: () => void;
}): React.ReactNode {
  switch (node.type) {
    case 1:
    case 2:
    case 3:
      return <span className="tabular-nums text-amber-300">{formatNum(node.num as number)}</span>;
    case 4:
      return (
        <span className="tabular-nums text-rose-300">
          {(node.num as bigint).toLocaleString("en-US")}
          <span className="text-rose-400/60">L</span>
        </span>
      );
    case 5:
    case 6:
      return <span className="tabular-nums text-amber-300">{fmtFloat(node.num as number)}</span>;
    case 8: {
      const s = node.str ?? "";
      const long = s.length > STR_PREVIEW;
      return (
        <>
          <span className="min-w-0 break-all text-emerald-300/90">
            "{long && !strOpen ? s.slice(0, STR_PREVIEW) + "…" : s}"
          </span>
          {long ? (
            <button
              type="button"
              onClick={onStr}
              className="shrink-0 text-[10px] text-emerald-600 hover:text-emerald-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
              title={strOpen ? "Collapse string" : "Show the full string"}
            >
              {strOpen ? "less" : `+${formatNum(s.length - STR_PREVIEW)}`}
            </button>
          ) : null}
        </>
      );
    }
    case 7:
    case 11:
    case 12: {
      const len = arrLen(node);
      const limit = arrOpen ? ARR_EXPANDED : ARR_PREVIEW;
      const parts: string[] = [];
      for (let i = 0; i < len && i < limit; i++) parts.push(arrElem(node, i));
      return (
        <>
          <span className="shrink-0 tabular-nums text-zinc-500">[{formatNum(len)}]</span>
          <span className="min-w-0 break-all text-teal-300/90">
            {parts.join(", ")}{len > limit ? ", …" : ""}
          </span>
          {len > ARR_PREVIEW ? (
            <button
              type="button"
              onClick={onArr}
              className="shrink-0 text-[10px] text-teal-600 hover:text-teal-300 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500"
              title={arrOpen ? "Show fewer values" : `Show the first ${ARR_EXPANDED} values`}
            >
              {arrOpen ? "less" : `+${formatNum(len - ARR_PREVIEW)}`}
            </button>
          ) : null}
        </>
      );
    }
    case 9:
      return (
        <span className="text-zinc-500">
          {formatNum((node.children ?? []).length)} × {TAG_NAME[node.listType ?? 0]}
        </span>
      );
    case 10:
      return <span className="text-zinc-500">{formatNum((node.children ?? []).length)} tags</span>;
    default:
      return null;
  }
}
