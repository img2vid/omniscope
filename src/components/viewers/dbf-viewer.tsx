"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState,
  Chip, InfoGrid, Field, SectionCard, EmptyHint,
} from "./viewer-ui";
import { latin1, downloadBlob, formatNum } from "@/lib/utils";
import { u32le, u16le } from "@/lib/binary";
import {
  Database, Table2, Search, ArrowUpDown, Download, FileJson, FileSpreadsheet,
  Trash2, Layers, CalendarClock,
} from "lucide-react";

/* ============================== data model ============================== */

type DbfCell = string | number | boolean | null;

interface DbfField {
  name: string;
  type: string;       // C/N/F/D/L/M/I/B/O/@/+ /G/T…
  length: number;
  decimal: number;
}

interface DbfRow {
  idx: number;        // original record number (1-based)
  deleted: boolean;
  cells: DbfCell[];
}

interface DbfTable {
  version: number;
  versionDesc: string;
  lastUpdate: string;
  recordCount: number;    // declared in header
  parsedCount: number;    // actually read
  headerSize: number;
  recordSize: number;
  fields: DbfField[];
  rows: DbfRow[];
  deletedCount: number;
  hasMemo: boolean;
  truncated: boolean;
  sizeMismatch: boolean;
}

const VERSIONS: Record<number, string> = {
  0x02: "FoxBASE",
  0x03: "dBase III+/FoxPro (no memo)",
  0x04: "dBase IV (no memo)",
  0x05: "dBase V (no memo)",
  0x30: "Visual FoxPro",
  0x31: "Visual FoxPro (autoincrement)",
  0x32: "Visual FoxPro (varchar)",
  0x43: "dBase IV SQL table",
  0x7b: "dBase IV with memo",
  0x83: "dBase III+ with memo (.dbt)",
  0x8b: "dBase IV with memo (.dbt)",
  0xf5: "FoxPro with memo (.fpt)",
  0xfb: "FoxPro (variant)",
};

/* ================================ parsing ================================ */

function parseDbf(bytes: Uint8Array): DbfTable {
  if (bytes.length < 33) throw new Error("File too small to be a dBase file");
  if (bytes[0] !== 0x03 && bytes[0] !== 0x30 && bytes[0] !== 0x31 && bytes[0] !== 0x32 && (bytes[0] & 0x07) !== 0x03) {
    // be permissive: 0x02, 0x04, 0x05, 0x43, 0x7b, 0x83, 0x8b, 0xf5, 0xfb…
    if (!(bytes[0] in VERSIONS)) {
      throw new Error(`Not a dBase file — unknown version byte 0x${bytes[0].toString(16).padStart(2, "0")}`);
    }
  }

  const version = bytes[0];
  const yy = 1900 + bytes[1];
  const mm = bytes[2];
  const dd = bytes[3];
  const lastUpdate = mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 ? `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : "unknown";
  const recordCount = u32le(bytes, 4);
  const headerSize = u16le(bytes, 8);
  const recordSize = u16le(bytes, 10);

  // field descriptors from offset 32 until 0x0D terminator
  const fields: DbfField[] = [];
  let off = 32;
  while (off + 32 <= bytes.length && bytes[off] !== 0x0d) {
    const name = latin1(bytes.subarray(off, off + 11)).replace(/\0.*$/, "").trim();
    const type = String.fromCharCode(bytes[off + 11]);
    const length = bytes[off + 16];
    const decimal = bytes[off + 17];
    if (length === 0 && !name) break;
    fields.push({ name: name || `F${fields.length + 1}`, type, length: Math.max(1, length), decimal });
    off += 32;
  }
  if (bytes[off] !== 0x0d) throw new Error("Field descriptor table not terminated with 0x0D — not a dBase file");
  if (!fields.length) throw new Error("No field descriptors found");

  const dataStart = headerSize > 0 ? headerSize : off + 1;
  const sumLen = 1 + fields.reduce((a, f) => a + f.length, 0);
  const sizeMismatch = recordSize > 0 && recordSize !== sumLen;

  const rs = recordSize > 0 ? recordSize : sumLen;
  const available = bytes.length > dataStart ? Math.floor((bytes.length - dataStart) / rs) : 0;
  const parsedCount = Math.min(recordCount, available);
  const truncated = parsedCount < recordCount;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows: DbfRow[] = [];
  let deletedCount = 0;

  const readCell = (base: number, field: DbfField): DbfCell => {
    const slice = latin1(bytes.subarray(base, base + field.length));
    const s = slice.replace(/\0/g, " ").trim();
    switch (field.type) {
      case "C":
      case "V": // varchar
        return s;
      case "N":
      case "F":
      case "Z": {
        if (!s) return null;
        const v = parseFloat(s);
        return Number.isNaN(v) ? null : v;
      }
      case "D": {
        if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        return null;
      }
      case "L": {
        const c = s.toUpperCase();
        if (c === "T" || c === "Y" || c === "J") return true;
        if (c === "F" || c === "N") return false;
        return null; // ? / space
      }
      case "M":
      case "G": { // memo pointer (10-digit block number in .dbt)
        if (!s) return null;
        const v = parseInt(s, 10);
        return Number.isNaN(v) ? null : v;
      }
      case "I":
      case "+": {
        if (field.length === 4 && base + 4 <= bytes.length) {
          try { return dv.getInt32(base, true); } catch { return null; }
        }
        const v = parseInt(s, 10);
        return Number.isNaN(v) ? null : v;
      }
      case "B":
      case "O":
      case "Y": {
        if (field.length === 8 && base + 8 <= bytes.length) {
          try { return dv.getFloat64(base, true); } catch { return null; }
        }
        const v = parseFloat(s);
        return Number.isNaN(v) ? null : v;
      }
      case "@": { // timestamp: julian day (int32) + msec (int32)
        if (field.length === 8 && base + 8 <= bytes.length) {
          try {
            const j = dv.getInt32(base, true);
            return j ? `jd:${j}` : null;
          } catch { return null; }
        }
        return s || null;
      }
      case "T": {
        if (field.length === 8 && base + 8 <= bytes.length) {
          try { return dv.getFloat64(base, true); } catch { return null; }
        }
        return s || null;
      }
      default:
        return s || null;
    }
  };

  for (let r = 0; r < parsedCount && r < 500_000; r++) {
    const base = dataStart + r * rs;
    if (base + rs > bytes.length) break;
    const flag = bytes[base];
    const deleted = flag === 0x2a;
    if (deleted) deletedCount++;
    let fo = base + 1;
    const cells: DbfCell[] = [];
    let ok = true;
    for (const f of fields) {
      if (fo + f.length > bytes.length) { ok = false; break; }
      cells.push(readCell(fo, f));
      fo += f.length;
    }
    if (!ok) break;
    rows.push({ idx: r + 1, deleted, cells });
  }

  const hasMemo = fields.some((f) => f.type === "M" || f.type === "G") ||
    version === 0x83 || version === 0x8b || version === 0xf5 || version === 0x7b || version === 0x43;

  return {
    version,
    versionDesc: VERSIONS[version] ?? `unknown (0x${version.toString(16).padStart(2, "0")})`,
    lastUpdate,
    recordCount,
    parsedCount: rows.length,
    headerSize,
    recordSize,
    fields,
    rows,
    deletedCount,
    hasMemo,
    truncated,
    sizeMismatch,
  };
}

/* ================================ helpers ================================ */

function cellText(c: DbfCell): string {
  if (c === null) return "";
  if (typeof c === "boolean") return c ? "true" : "false";
  return String(c);
}

function isNumericField(f: DbfField): boolean {
  return ["N", "F", "I", "B", "O", "+", "Y", "Z", "M"].includes(f.type);
}

function compareCells(a: DbfCell, b: DbfCell, numeric: boolean): number {
  const aNull = a === null || a === "";
  const bNull = b === null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls last
  if (bNull) return -1;
  if (numeric) {
    const av = typeof a === "number" ? a : parseFloat(String(a));
    const bv = typeof b === "number" ? b : parseFloat(String(b));
    if (Number.isNaN(av) || Number.isNaN(bv)) return String(a).localeCompare(String(b));
    return av - bv;
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    const av = a === true ? 1 : 0;
    const bv = b === true ? 1 : 0;
    return av - bv;
  }
  return String(a).localeCompare(String(b));
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const PAGE = 300;

/* ================================ component =============================== */

export default function DbfViewer({ arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [table, setTable] = React.useState<DbfTable | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortAsc, setSortAsc] = React.useState(true);
  const [filter, setFilter] = React.useState("");
  const [showDeleted, setShowDeleted] = React.useState(false);
  const [visible, setVisible] = React.useState(PAGE);

  React.useEffect(() => {
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      if (bytes.length === 0) throw new Error("File is empty");
      setTable(parseDbf(bytes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  const rows = React.useMemo(
    () => (table ? (showDeleted ? table.rows : table.rows.filter((r) => !r.deleted)) : []),
    [table, showDeleted],
  );

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.cells.some((c) => cellText(c).toLowerCase().includes(q)));
  }, [rows, filter]);

  const sorted = React.useMemo(() => {
    if (sortCol === null || !table) return filtered;
    const numeric = isNumericField(table.fields[sortCol]);
    const arr = [...filtered];
    arr.sort((a, b) => {
      const c = compareCells(a.cells[sortCol] ?? null, b.cells[sortCol] ?? null, numeric);
      return sortAsc ? c : -c;
    });
    return arr;
  }, [filtered, sortCol, sortAsc, table]);

  if (error) return <ErrorCard title="Could not parse dBase file" message={error} hint="Expected a dBase III/IV/V or FoxPro .dbf table." />;
  if (!table) return <LoadingState label="Parsing dBase table…" />;

  const pageRows = sorted.slice(0, visible);

  function setSort(i: number) {
    if (sortCol === i) setSortAsc((a) => !a);
    else { setSortCol(i); setSortAsc(true); }
    setVisible(PAGE);
  }

  function exportCsv() {
    if (!table) return;
    const header = table.fields.map((f) => csvEscape(f.name)).join(",");
    const lines = sorted.map((r) =>
      r.cells.map((c, i) => {
        if (c === null) return "";
        if (typeof c === "boolean") return c ? "T" : "F";
        if (table.fields[i]?.type === "M") return `memo:${c}`;
        return csvEscape(String(c));
      }).join(","),
    );
    const csv = [header, ...lines].join("\r\n");
    const base = fileName.replace(/\.[^.]+$/, "") || "table";
    downloadBlob(csv, `${base}.csv`, "text/csv;charset=utf-8");
  }

  function exportJson() {
    if (!table) return;
    const objs = sorted.map((r) => {
      const o: Record<string, unknown> = { _deleted: r.deleted, _rec: r.idx };
      table.fields.forEach((f, i) => {
        const c = r.cells[i];
        o[f.name] = f.type === "M" && typeof c === "number" ? `memo:${c}` : c;
      });
      return o;
    });
    const base = fileName.replace(/\.[^.]+$/, "") || "table";
    downloadBlob(JSON.stringify(objs, null, 2), `${base}.json`, "application/json");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.name}</Chip>
            <Chip tone="teal">{formatNum(table.parsedCount)} rows</Chip>
            <Chip tone="zinc">{table.fields.length} fields</Chip>
            {table.hasMemo ? <Chip tone="amber">memo</Chip> : null}
            {table.deletedCount ? <Chip tone="zinc">{formatNum(table.deletedCount)} deleted</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setVisible(PAGE); }}
              placeholder="Filter records…"
              className="w-24 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none sm:w-48"
            />
            {filter ? (
              <button type="button" onClick={() => setFilter("")} className="text-zinc-500 hover:text-zinc-300" aria-label="Clear">✕</button>
            ) : null}
          </div>
        }
        right={
          <>
            <ToolButton label="Deleted" active={showDeleted} onClick={() => setShowDeleted((v) => !v)} title="Show/hide records flagged as deleted">
              <Trash2 className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="CSV" onClick={exportCsv} title="Export filtered rows as CSV">
              <FileSpreadsheet className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="JSON" onClick={exportJson} title="Export filtered rows as JSON">
              <FileJson className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <ViewerBody>
        <div className="p-4">
          <div className="mx-auto max-w-6xl space-y-4">
            {table.truncated ? (
              <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                Header declares {formatNum(table.recordCount)} records but the file{arrayBuffer === null ? " preview (first 64 KB)" : ""} only contains
                {" "}{formatNum(table.parsedCount)} — table is truncated.
              </div>
            ) : null}
            {table.sizeMismatch ? (
              <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                Record size in header ({table.recordSize}) does not match the sum of field lengths — some values may look shifted.
              </div>
            ) : null}

            <SectionCard title="Table" icon={<Table2 className="h-3.5 w-3.5" />} right={<Chip tone="zinc">{formatNum(sorted.length)} shown</Chip>}>
              <div className="max-h-[55vh] overflow-auto rounded-lg border border-zinc-800 scrollbar-thin">
                <table className="min-w-full border-collapse text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-zinc-900 text-left">
                      <th className="whitespace-nowrap border-b border-zinc-800 px-2 py-1.5 pr-3 text-[10px] font-semibold text-zinc-500">#</th>
                      {table.fields.map((f, i) => (
                        <th key={i} className="whitespace-nowrap border-b border-zinc-800 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setSort(i)}
                            className="group inline-flex items-center gap-1.5 text-left"
                            title={`Sort by ${f.name} (${f.type})`}
                          >
                            <span className="font-semibold text-zinc-200 group-hover:text-emerald-300">{f.name}</span>
                            <Chip tone={f.type === "M" ? "amber" : isNumericField(f) ? "teal" : "zinc"}>
                              {f.type}{f.length > 1 ? `·${f.length}` : ""}
                            </Chip>
                            <ArrowUpDown className={`h-3 w-3 ${sortCol === i ? "text-emerald-400" : "text-zinc-700 group-hover:text-zinc-500"}`} />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.idx} className={`border-b border-zinc-800/50 hover:bg-zinc-900/40 ${r.deleted ? "opacity-50" : ""}`}>
                        <td className="whitespace-nowrap px-2 py-1 pr-3 text-right font-mono text-[10px] text-zinc-600">
                          {r.idx}
                          {r.deleted ? <Trash2 className="ml-1 inline h-3 w-3 text-amber-500/80" aria-label="deleted" /> : null}
                        </td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="whitespace-nowrap px-2 py-1">
                            {c === null ? (
                              <span className="text-zinc-700">∅</span>
                            ) : table.fields[i].type === "M" ? (
                              <Chip tone="amber">memo:{c}</Chip>
                            ) : typeof c === "number" ? (
                              <span className="font-mono text-zinc-300">{formatNum(c)}</span>
                            ) : typeof c === "boolean" ? (
                              <Chip tone={c ? "emerald" : "zinc"}>{c ? "T" : "F"}</Chip>
                            ) : (
                              <span className="text-zinc-300">{c}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!pageRows.length ? <EmptyHint>No records{filter ? ` matching “${filter}”` : ""}.</EmptyHint> : null}
              {visible < sorted.length ? (
                <div className="mt-3 flex items-center justify-center">
                  <ToolButton label={`Load ${Math.min(PAGE, sorted.length - visible)} more`} onClick={() => setVisible((v) => v + PAGE)}>
                    <Layers className="h-3.5 w-3.5" />
                  </ToolButton>
                  <span className="ml-3 text-[11px] text-zinc-500">
                    {formatNum(visible)} / {formatNum(sorted.length)} rows rendered
                  </span>
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="File header" icon={<Database className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Version" mono>0x{table.version.toString(16).padStart(2, "0")} — {table.versionDesc}</Field>
                <Field label="Last update">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3 text-zinc-500" />
                    {table.lastUpdate}
                  </span>
                </Field>
                <Field label="Records (declared)">{formatNum(table.recordCount)}</Field>
                <Field label="Records (parsed)">{formatNum(table.parsedCount)}</Field>
                <Field label="Fields">{table.fields.length}</Field>
                <Field label="Header size" mono>{formatNum(table.headerSize)} B</Field>
                <Field label="Record size" mono>{formatNum(table.recordSize)} B</Field>
                <Field label="Deleted records">{formatNum(table.deletedCount)}</Field>
                <Field label="Memo file">{table.hasMemo ? "yes — .dbt/.fpt companion (pointers shown)" : "no"}</Field>
              </InfoGrid>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-zinc-800 pt-3 text-[11px] sm:grid-cols-3">
                {table.fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-zinc-400">
                    <Chip tone="zinc">{f.type}</Chip>
                    <span className="truncate text-zinc-300">{f.name}</span>
                    <span className="text-zinc-600">{f.length}{f.decimal ? `.${f.decimal}` : ""}</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Download className="h-3.5 w-3.5" />
        <span className="truncate">{table.fields.length} fields · {formatNum(table.parsedCount)} records · {fileName}</span>
      </div>
    </div>
  );
}
