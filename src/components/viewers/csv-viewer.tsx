"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, LoadingState, Segmented, Chip, EmptyHint,
} from "./viewer-ui";
import { cn, formatNum, downloadBlob } from "@/lib/utils";
import {
  Table, BarChart3, LineChart, ArrowUpDown, Download, Search, Filter, Grid3X3, Sheet,
} from "lucide-react";

const MAX_ROWS = 100_000;

export default function CsvViewer({ arrayBuffer, head, fileName }: ViewerProps) {
  const [rows, setRows] = React.useState<string[][] | null>(null);
  const [delim, setDelim] = React.useState<string>(",");
  const [mode, setMode] = React.useState<"table" | "chart">("table");
  const [sortCol, setSortCol] = React.useState<number | null>(null);
  const [sortAsc, setSortAsc] = React.useState(true);
  const [filter, setFilter] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [chartCol, setChartCol] = React.useState(1);
  const PAGE = 200;

  React.useEffect(() => {
    const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 6 * 1024 * 1024));
    // sniff delimiter
    const firstLines = text.split(/\r?\n/).filter(Boolean).slice(0, 8);
    let best = ",";
    let bestScore = 0;
    for (const d of [",", "\t", ";", "|"]) {
      const counts = firstLines.map((l) => l.split(d).length - 1);
      if (counts.length && counts.every((c) => c === counts[0]) && counts[0] > bestScore) {
        best = d;
        bestScore = counts[0];
      }
    }
    setDelim(best);
    const parsed: string[][] = [];
    let cur: string[] = [];
    let field = "";
    let inQuotes = false;
    const src = text;
    for (let i = 0; i < src.length && parsed.length < MAX_ROWS; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === best) {
        cur.push(field);
        field = "";
      } else if (ch === "\n") {
        cur.push(field);
        parsed.push(cur);
        cur = [];
        field = "";
      } else if (ch === "\r") {
        // skip
      } else {
        field += ch;
      }
    }
    if (field || cur.length) { cur.push(field); parsed.push(cur); }
    setRows(parsed);
  }, [arrayBuffer, head]);

  const filtered = React.useMemo(() => {
    if (!rows || !filter.trim()) return rows ?? [];
    const body = rows.slice(1);
    const q = filter.toLowerCase();
    return body.filter((r) => r.some((c) => c.toLowerCase().includes(q)));
  }, [rows, filter]);

  const sorted = React.useMemo(() => {
    if (sortCol === null) return filtered;
    const isNum = filtered.slice(0, 20).every((r) => r[sortCol] === undefined || r[sortCol] === "" || !Number.isNaN(parseFloat(r[sortCol])));
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      if (isNum) return (parseFloat(av) || 0) - (parseFloat(bv) || 0);
      return av.localeCompare(bv);
    });
    return sortAsc ? arr : arr.reverse();
  }, [filtered, sortCol, sortAsc]);

  // column type inference for chart
  const numericCols = React.useMemo(() => {
    if (!rows) return [] as boolean[];
    const body = rows.slice(1);
    return rows[0].map((_, i) => {
      let nums = 0, nonEmpty = 0;
      for (let r = 0; r < Math.min(200, body.length); r++) {
        const v = body[r][i];
        if (v === undefined || v === "") continue;
        nonEmpty++;
        if (!Number.isNaN(parseFloat(v))) nums++;
      }
      return nonEmpty > 0 && nums / nonEmpty > 0.85;
    });
  }, [rows]);

  if (!rows) return <LoadingState label="Parsing table…" />;
  if (rows.length < 2) return <EmptyHint>Not enough rows for a table — showing text view might be better.</EmptyHint>;

  const headers = rows[0].map((h, i) => h || `col ${i + 1}`);
  const body = rows.slice(1);

  const pageRows = sorted.slice(page * PAGE, (page + 1) * PAGE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));

  function setSort(i: number) {
    if (sortCol === i) setSortAsc((a) => !a);
    else { setSortCol(i); setSortAsc(true); }
    setPage(0);
  }

  /* export what you see (filter + sort applied) as a real XLSX workbook, client-side */
  const exportXlsx = async () => {
    try {
      const XLSX: any = await import("xlsx");
      const aoa = [headers, ...sorted];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // column widths from max cell length (capped) for a tidy first open
      const widths = headers.map((h, c) => {
        let w = Math.max(String(h ?? "").length, 6);
        for (let r = 0; r < Math.min(sorted.length, 500); r++) {
          w = Math.max(w, Math.min(String(sorted[r]?.[c] ?? "").length, 40));
        }
        return { wch: Math.min(w + 2, 42) };
      });
      ws["!cols"] = widths;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Data");
      const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      downloadBlob(
        new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        (fileName.replace(/\.\w+$/, "") || "table") + ".xlsx",
      );
    } catch (e) {
      console.error("xlsx export failed", e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{delim === "\t" ? "TSV" : delim === ";" ? "semicolon" : delim === "|" ? "pipe" : "CSV"}</Chip>
            <Chip>{formatNum(rows.length)} rows</Chip>
            <Chip>{formatNum(headers.length)} cols</Chip>
            {numericCols.filter(Boolean).length ? <Chip tone="teal">{numericCols.filter(Boolean).length} numeric</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-xs items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Filter className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
              placeholder="Filter rows…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {filter ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{formatNum(filtered.length)}</span> : null}
          </div>
        }
        right={
          <>
            <Segmented value={mode} onChange={setMode} options={[{ value: "table", label: "Table" }, { value: "chart", label: "Chart" }]} />
            <ToolbarDivider />
            <ToolButton label="JSON" onClick={() => {
              const objs = sorted.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
              downloadBlob(new Blob([JSON.stringify(objs, null, 2)], { type: "application/json" }), fileName.replace(/\.\w+$/, "") + ".json");
            }} title="Export visible rows as JSON (respects filter & sort)"><Download className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="XLSX" onClick={() => { void exportXlsx(); }} title="Export as Excel workbook (respects filter & sort)">
              <Sheet className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      {mode === "table" ? (
        <>
          <ViewerBody className="relative">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-900">
                  <th className="border-b border-zinc-700 px-2 py-1.5 text-right font-mono text-[10px] font-normal text-zinc-600">#</th>
                  {headers.map((h, i) => (
                    <th key={i} className="border-b border-l border-zinc-800 px-2 py-1.5 text-left font-semibold text-zinc-200">
                      <button
                        type="button"
                        onClick={() => setSort(i)}
                        className={cn("flex w-full items-center gap-1 text-left hover:text-emerald-300", sortCol === i && "text-emerald-300")}
                      >
                        <span className="truncate">{h}</span>
                        <ArrowUpDown className={cn("h-3 w-3 shrink-0", sortCol === i ? "text-emerald-400" : "text-zinc-600")} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, ri) => (
                  <tr key={ri} className="group hover:bg-zinc-900/60">
                    <td className="border-b border-zinc-800/50 px-2 py-1 text-right font-mono text-[10px] text-zinc-700">{page * PAGE + ri + 1}</td>
                    {headers.map((_, ci) => {
                      const v = r[ci] ?? "";
                      const isNum = numericCols[ci] && v !== "" && !Number.isNaN(parseFloat(v));
                      return (
                        <td
                          key={ci}
                          title={v}
                          className={cn(
                            "max-w-[24rem] truncate border-b border-l border-zinc-800/50 px-2 py-1 text-zinc-300",
                            isNum && "text-right font-mono text-rose-300/90",
                          )}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ViewerBody>
          <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
            <Table className="h-3.5 w-3.5" />
            <span>page {page + 1} / {totalPages}</span>
            <div className="ml-2 flex gap-1">
              <ToolButton disabled={page === 0} onClick={() => setPage(0)}>«</ToolButton>
              <ToolButton disabled={page === 0} onClick={() => setPage(page - 1)}>‹</ToolButton>
              <ToolButton disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>›</ToolButton>
              <ToolButton disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</ToolButton>
            </div>
            <span className="ml-auto">click headers to sort</span>
          </div>
        </>
      ) : (
        <ViewerBody className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <BarChart3 className="h-4 w-4 text-zinc-500" />
            <span className="text-xs text-zinc-400">X axis:</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
              value={Math.min(0, headers.length - 1)}
              disabled
            >
              <option>{headers[0]}</option>
            </select>
            <span className="text-xs text-zinc-400">Y axis:</span>
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
              value={chartCol}
              onChange={(e) => setChartCol(Number(e.target.value))}
            >
              {headers.map((h, i) => (
                <option key={i} value={i}>{h}{numericCols[i] ? " (#)" : ""}</option>
              ))}
            </select>
            {numericCols[chartCol] ? null : <Chip tone="amber">not numeric — using lengths</Chip>}
          </div>
          <CsvChart
            data={sorted.slice(0, 60).map((r) => ({
              label: String(r[0] ?? "").slice(0, 14),
              value: numericCols[chartCol] ? parseFloat(r[chartCol] ?? "") || 0 : String(r[chartCol] ?? "").length,
            }))}
          />
        </ViewerBody>
      )}
    </div>
  );
}

function CsvChart({ data }: { data: { label: string; value: number }[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex h-64 items-end gap-1.5">
        {data.map((d, i) => (
          <div
            key={i}
            className="group relative flex min-w-0 flex-1 flex-col items-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === i ? (
              <div className="absolute -top-8 z-10 whitespace-nowrap rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200">
                {d.label}: {d.value}
              </div>
            ) : null}
            <div
              className={cn(
                "w-full rounded-t bg-gradient-to-t transition-all",
                d.value >= 0 ? "from-emerald-900/60 to-emerald-500" : "from-rose-900/60 to-rose-500",
                hover === i && "from-emerald-800 to-emerald-300",
              )}
              style={{ height: `${Math.max(2, (Math.abs(d.value - Math.min(0, min)) / range) * 220)}px` }}
            />
            <span className="mt-1 w-full truncate text-center text-[9px] text-zinc-600">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
