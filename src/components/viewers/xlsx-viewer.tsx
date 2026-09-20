"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint,
} from "./viewer-ui";
import { cn, downloadBlob, formatNum, formatBytes } from "@/lib/utils";
import { Sheet, Table, Search, Download, Grid3X3, X, Sigma, Braces } from "lucide-react";


const PAGE_ROWS = 300;       // rows rendered per batch
const MAX_COLS = 100;        // columns rendered
const SEARCH_CELL_CAP = 2_000_000;
const SEARCH_MATCH_CAP = 100;

interface CellPos { r: number; c: number }
interface CellMatch { r: number; c: number; text: string }

interface LoadedBook {
  wb: any;
  sheetNames: string[];
}

function cellText(cell: any): string {
  if (!cell) return "";
  const v = cell.v;
  if (cell.t === "d" && v instanceof Date) return v.toISOString();
  if (cell.w !== undefined && cell.w !== null) return String(cell.w);
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString();
  if (cell.t === "b") return v ? "TRUE" : "FALSE";
  return String(v);
}

export default function XlsxViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [book, setBook] = React.useState<LoadedBook | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [active, setActive] = React.useState("");
  const [visibleRows, setVisibleRows] = React.useState(PAGE_ROWS);
  const [selected, setSelected] = React.useState<CellPos | null>(null);
  const [query, setQuery] = React.useState("");
  const [matches, setMatches] = React.useState<CellMatch[] | null>(null);
  const [scanned, setScanned] = React.useState(0);
  const [exportNote, setExportNote] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setBook(null);
      setError(null);
      try {
        if (!arrayBuffer) {
          setError({
            message: "This workbook exceeds the in-memory load cap (96 MB).",
            hint: "Use the hex view for inspection, or split/convert the workbook first.",
          });
          return;
        }
        const XLSX: any = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: "array", cellDates: true });
        if (cancelled) return;
        const sheetNames: string[] = (wb?.SheetNames ?? []).filter((n: any) => typeof n === "string");
        if (!sheetNames.length) throw new Error("no sheets found — is this a valid workbook?");
        setBook({ wb, sheetNames });
        setActive(sheetNames[0]);
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "SheetJS could not parse this workbook. The file may be corrupted, encrypted (.xlsx password), or not a spreadsheet.",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer]);

  React.useEffect(() => {
    setVisibleRows(PAGE_ROWS);
    setSelected(null);
    setMatches(null);
    setQuery("");
  }, [active]);

  const sheet: any = book && active ? book.wb.Sheets[active] : null;
  const range = React.useMemo(() => {
    if (!book || !sheet || !sheet["!ref"]) return null;
    try {
      return decodeRange(sheet["!ref"]);
    } catch {
      return null;
    }
  }, [book, sheet]);

  const formulaCount = React.useMemo(() => countFormulas(sheet), [sheet]);

  if (error) return <ErrorCard title="Cannot open this spreadsheet" message={error.message} hint={error.hint} />;

  if (!book) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">Sheet</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Parsing workbook…" />
      </div>
    );
  }

  const rows = range ? range.e.r - range.s.r + 1 : 0;
  const cols = range ? Math.min(range.e.c - range.s.c + 1, MAX_COLS) : 0;
  const totalCols = range ? range.e.c - range.s.c + 1 : 0;

  /* ------------------------------ search ------------------------------ */
  const runSearch = () => {
    const q = query.trim().toLowerCase();
    if (!q || !sheet || !range) { setMatches(null); return; }
    const out: CellMatch[] = [];
    let scannedCells = 0;
    for (let r = range.s.r; r <= range.e.r && out.length < SEARCH_MATCH_CAP; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (++scannedCells > SEARCH_CELL_CAP) break;
        const cell = sheet[addr(r, c)];
        if (!cell) continue;
        const t = cellText(cell).toLowerCase();
        if (t && t.includes(q)) {
          out.push({ r, c, text: cellText(cell).slice(0, 80) });
          if (out.length >= SEARCH_MATCH_CAP) break;
        }
      }
    }
    setScanned(scannedCells);
    setMatches(out);
  };

  const jumpTo = (m: CellMatch) => {
    const rowIdx = m.r - (range?.s.r ?? 0);
    if (rowIdx >= visibleRows) setVisibleRows(Math.min(rows, rowIdx + 20));
    setSelected({ r: m.r, c: m.c });
    requestAnimationFrame(() => {
      document.getElementById(`xc-${m.r}-${m.c}`)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    });
  };

  const selectedCell = sheet && selected ? sheet[addr(selected.r, selected.c)] : null;

  const exportCsv = async () => {
    if (!sheet) return;
    const XLSX: any = await import("xlsx");
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const base = fileName.replace(/\.\w+$/, "");
    downloadBlob(csv, `${base}${book.sheetNames.length > 1 ? "-" + sanitize(active) : ""}.csv`, "text/csv");
  };

  /* active sheet → array of row objects (first row used as keys, matching sheet_to_csv semantics) */
  const exportJson = async () => {
    if (!sheet) return;
    const XLSX: any = await import("xlsx");
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
    const base = fileName.replace(/\.\w+$/, "");
    const suffix = book.sheetNames.length > 1 ? "-" + sanitize(active) : "";
    downloadBlob(
      JSON.stringify(rows, null, 2),
      `${base}${suffix}.json`,
      "application/json",
    );
  };

  /* whole workbook → modern .xlsx (format conversion for .xls / .ods / .xlsb sources) */
  const exportXlsx = async () => {
    if (!book) return;
    const XLSX: any = await import("xlsx");
    try {
      const out = XLSX.write(book.wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
      const base = fileName.replace(/\.\w+$/, "") || "workbook";
      downloadBlob(
        new Uint8Array(out),
        base.toLowerCase().endsWith(".xlsx") ? base : `${base}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
    } catch {
      setExportNote("SheetJS could not re-serialize this workbook as .xlsx — try the CSV export instead.");
      window.setTimeout(() => setExportNote(null), 5000);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.ext ? detected.ext.toUpperCase() : "Workbook"}</Chip>
            <Chip>{formatNum(book.sheetNames.length)} sheet{book.sheetNames.length === 1 ? "" : "s"}</Chip>
            {range ? <Chip>{formatNum(rows)} × {formatNum(totalCols)}</Chip> : null}
            {formulaCount ? <Chip tone="teal"><span className="inline-flex items-center gap-1"><Sigma className="h-3 w-3" />{formatNum(formulaCount)} formulas</span></Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-[15rem] items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2 focus-within:border-emerald-700">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setMatches(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search sheet…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {matches ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{matches.length}</span> : null}
          </div>
        }
        right={
          <>
            <ToolButton label="CSV" onClick={exportCsv} title="Export active sheet as CSV"><Download className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="JSON" onClick={() => { void exportJson(); }} title="Export active sheet as JSON (row objects, typed values)"><Braces className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="XLSX" onClick={() => { void exportXlsx(); }} title="Re-pack the whole workbook as modern .xlsx — converts .xls / .ods / .xlsb"><Grid3X3 className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />

      {exportNote ? (
        <div className="mx-2 mt-2 flex shrink-0 items-center gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-300">
          <span className="font-mono">!</span>
          {exportNote}
        </div>
      ) : null}

      {/* sheet tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-950/60 px-2 py-1.5 scrollbar-thin">
        <Sheet className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
        {book.sheetNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setActive(name)}
            className={cn(
              "shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors",
              name === active
                ? "border-emerald-800/60 bg-emerald-900/40 text-emerald-300"
                : "border-zinc-700/60 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
            )}
          >
            {name}
          </button>
        ))}
      </div>

      {/* search results */}
      {matches ? (
        <div className="max-h-40 shrink-0 overflow-y-auto border-b border-zinc-800 bg-zinc-900/70 scrollbar-thin">
          {matches.length ? (
            <div className="divide-y divide-zinc-800/60">
              {matches.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => jumpTo(m)}
                  className="flex w-full items-center gap-3 px-3 py-1 text-left text-[11px] hover:bg-zinc-800/60"
                >
                  <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1 font-mono text-[10px] text-emerald-300">{addr(m.r, m.c)}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{m.text}</span>
                </button>
              ))}
              {scanned >= SEARCH_CELL_CAP ? <div className="px-3 py-1 text-[10px] text-zinc-600">scan capped at {formatNum(SEARCH_CELL_CAP)} cells</div> : null}
            </div>
          ) : (
            <div className="px-3 py-1.5 text-[11px] text-zinc-500">No matches{query ? ` for “${query.trim()}”` : ""} in “{active}”.</div>
          )}
        </div>
      ) : null}

      <ViewerBody>
        {!range || rows === 0 ? (
          <EmptyHint>Sheet “{active}” is empty (no cell data).</EmptyHint>
        ) : (
          <div className="min-w-fit">
            <table className="border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-900">
                  <th className="border-b border-r border-zinc-700 px-2 py-1.5 text-right font-mono text-[10px] font-normal text-zinc-600">#</th>
                  {Array.from({ length: cols }, (_, i) => (
                    <th key={i} className="border-b border-r border-zinc-700 bg-zinc-900 px-2 py-1.5 text-center font-mono text-[10px] font-semibold text-zinc-400">
                      {colName(range.s.c + i)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.min(visibleRows, rows) }, (_, ri) => {
                  const r = range.s.r + ri;
                  return (
                    <tr key={r} className="group hover:bg-zinc-900/50">
                      <td className={cn(
                        "border-b border-r border-zinc-800/50 px-2 py-1 text-right font-mono text-[10px]",
                        selected?.r === r ? "bg-emerald-900/20 text-emerald-400" : "text-zinc-700",
                      )}>{r + 1}</td>
                      {Array.from({ length: cols }, (_, ci) => {
                        const c = range.s.c + ci;
                        const cell = sheet[addr(r, c)];
                        const text = cellText(cell);
                        const isSel = selected?.r === r && selected?.c === c;
                        const isNum = cell && (cell.t === "n" || cell.t === "d");
                        const isErr = cell && cell.t === "e";
                        return (
                          <td
                            key={c}
                            id={`xc-${r}-${c}`}
                            onClick={() => setSelected({ r, c })}
                            title={text ? `${addr(r, c)}: ${text}${cell?.f ? ` =${cell.f}` : ""}` : addr(r, c)}
                            className={cn(
                              "relative max-w-[16rem] cursor-cell truncate border-b border-r border-zinc-800/50 px-2 py-1 text-zinc-300",
                              isNum && "text-right font-mono text-rose-200/90",
                              isErr && "text-rose-400",
                              isSel && "bg-emerald-900/30 outline outline-1 outline-emerald-600",
                            )}
                          >
                            {text}
                            {cell?.f ? <span className="absolute right-0 top-0 h-0 w-0 border-b-[5px] border-l-[5px] border-b-transparent border-l-amber-500/70" aria-label="formula" /> : null}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleRows < rows ? (
              <div className="flex items-center justify-center gap-3 border-t border-zinc-800/50 p-3">
                <ToolButton
                  label={`Load ${formatNum(Math.min(PAGE_ROWS, rows - visibleRows))} more rows`}
                  onClick={() => setVisibleRows((v) => v + PAGE_ROWS)}
                >
                  <Table className="h-3.5 w-3.5" />
                </ToolButton>
                <span className="text-[11px] text-zinc-600">
                  showing {formatNum(Math.min(visibleRows, rows))} / {formatNum(rows)} rows
                </span>
              </div>
            ) : null}
            {totalCols > MAX_COLS ? (
              <div className="p-3 text-center text-[11px] text-zinc-600">… {formatNum(totalCols - MAX_COLS)} more columns not rendered (max {MAX_COLS})</div>
            ) : null}
          </div>
        )}
      </ViewerBody>

      {/* cell detail panel */}
      {selected ? (
        <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/80 px-3 py-2">
          <div className="flex items-start gap-3">
            <span className="shrink-0 rounded border border-emerald-800/60 bg-emerald-900/40 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">{addr(selected.r, selected.c)}</span>
            <div className="min-w-0 flex-1 space-y-1 text-[11px]">
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-zinc-500">type</span>
                <span className="font-mono text-zinc-300">{selectedCell ? String(selectedCell.t) : "empty"}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-14 shrink-0 text-zinc-500">value</span>
                <span className="min-w-0 break-all font-mono text-zinc-200">{selectedCell ? describeValue(selectedCell) : "—"}</span>
              </div>
              {selectedCell?.f ? (
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 text-amber-500/80">formula</span>
                  <span className="min-w-0 break-all font-mono text-amber-300">={String(selectedCell.f)}</span>
                </div>
              ) : null}
              {selectedCell?.z ? (
                <div className="flex gap-2">
                  <span className="w-14 shrink-0 text-zinc-500">format</span>
                  <span className="min-w-0 break-all font-mono text-zinc-400">{String(selectedCell.z)}</span>
                </div>
              ) : null}
            </div>
            <button type="button" onClick={() => setSelected(null)} className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" title="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Grid3X3 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{fileName} · {formatBytes(file.size)} · {detected.name}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">click a cell for value / formula details</span>
      </div>
    </div>
  );
}

/* ------------------------------ helpers ------------------------------ */

/** decode "A1:B9" without needing the lib loaded synchronously */
function decodeRange(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } } {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref.toUpperCase().replace(/\$/g, ""));
  if (!m) throw new Error(`bad ref ${ref}`);
  const c1 = colIndex(m[1]);
  const r1 = parseInt(m[2], 10) - 1;
  const c2 = m[3] ? colIndex(m[3]) : c1;
  const r2 = m[4] ? parseInt(m[4], 10) - 1 : r1;
  return { s: { r: r1, c: c1 }, e: { r: Math.max(r1, r2), c: Math.max(c1, c2) } };
}

function colIndex(name: string): number {
  let n = 0;
  for (let i = 0; i < name.length; i++) n = n * 26 + (name.charCodeAt(i) - 64);
  return n - 1;
}

function colName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function addr(r: number, c: number): string {
  return colName(c) + (r + 1);
}

function sanitize(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").slice(0, 40) || "sheet";
}

function describeValue(cell: any): string {
  const v = cell?.v;
  if (v === undefined || v === null) return "—";
  if (v instanceof Date) return `${v.toISOString()}  (Date)`;
  if (cell.t === "b") return v ? "TRUE (boolean)" : "FALSE (boolean)";
  if (typeof v === "number") return Number.isInteger(v) ? `${v} (number)` : `${v} (number)`;
  return `${String(v)} (string)`;
}

function countFormulas(sheet: any): number {
  if (!sheet) return 0;
  const ref = sheet["!ref"];
  if (!ref) return 0;
  try {
    const rg = decodeRange(ref);
    let n = 0;
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      for (let c = rg.s.c; c <= rg.e.c; c++) {
        if (sheet[addr(r, c)]?.f) n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}
