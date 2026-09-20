"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, ToolButton, Segmented, ToolbarDivider,
} from "./viewer-ui";
import { cn, formatBytes, formatNum, downloadBlob, toHex, hexDumpLine } from "@/lib/utils";
import { u16be, u32be, asciiAt } from "@/lib/binary";
import {
  Database, Table2, Eye, BarChart3, Zap, Terminal, Play, RefreshCw, Download, X, Binary, FileJson,
} from "lucide-react";

/* ============================== sql.js plumbing ============================== */

interface SqlResult { columns: string[]; values: unknown[][]; }
interface SqlDatabase {
  exec: (sql: string) => SqlResult[];
  close: () => void;
}

interface DbObject { type: "table" | "view" | "index" | "trigger" | string; name: string; sql: string | null; }

async function openDatabase(arrayBuffer: ArrayBuffer): Promise<SqlDatabase> {
  const mod: { default?: unknown } = await import("sql.js");
  const initSqlJs = (typeof mod.default === "function" ? mod.default : mod) as (cfg: { locateFile: (f: string) => string }) => Promise<{ Database: new (data: Uint8Array) => SqlDatabase }>;
  const SQL = await initSqlJs({ locateFile: (f: string) => "/" + f });
  return new SQL.Database(new Uint8Array(arrayBuffer));
}

/* ================================ header info ================================ */

function readHeader(head: Uint8Array) {
  if (head.length < 100 || asciiAt(head, 0, 15) !== "SQLite format ") return null;
  let pageSize = u16be(head, 16);
  if (pageSize === 1) pageSize = 65536;
  const writeVer = head[18];
  const readVer = head[19];
  const pageCount = u32be(head, 28);
  const enc = u32be(head, 56);
  const ver = u32be(head, 96);
  return {
    pageSize,
    pageCount,
    writeVer,
    readVer,
    encoding: enc === 1 ? "UTF-8" : enc === 2 ? "UTF-16le" : enc === 3 ? "UTF-16be" : `unknown (${enc})`,
    version: ver ? `${Math.floor(ver / 1000000)}.${Math.floor(ver / 1000) % 1000}.${ver % 1000}` : "—",
  };
}

/* ================================ cell render ================================ */

function renderCell(v: unknown): React.ReactNode {
  if (v === null) return <span className="italic text-zinc-600">NULL</span>;
  if (typeof v === "number") return <span className="tabular-nums">{formatNum(v)}</span>;
  if (typeof v === "string") return v.length > 120 ? v.slice(0, 120) + "…" : v;
  if (v instanceof Uint8Array) {
    return <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1 font-mono text-[10px] text-teal-300">{toHex(v.subarray(0, 6))}{v.length > 6 ? "…" : ""} · {formatBytes(v.length)}</span>;
  }
  return String(v);
}

function cellKind(v: unknown): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isInteger(v) ? "INTEGER" : "REAL";
  if (typeof v === "string") return "TEXT";
  if (v instanceof Uint8Array) return "BLOB";
  return typeof v;
}

/* ================================= viewer ================================= */

interface TableData { name: string; columns: string[]; rows: unknown[][]; total: number; offset: number; }

export default function SqliteViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const dbRef = React.useRef<SqlDatabase | null>(null);
  const [ready, setReady] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [objects, setObjects] = React.useState<DbObject[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [table, setTable] = React.useState<TableData | null>(null);
  const [tableErr, setTableErr] = React.useState<string | null>(null);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [cellSel, setCellSel] = React.useState<{ ri: number; ci: number } | null>(null);
  const [panel, setPanel] = React.useState<"data" | "sql">("data");
  const [sqlText, setSqlText] = React.useState("");
  const [sqlResult, setSqlResult] = React.useState<{ columns: string[]; rows: unknown[][]; ms: number; truncated?: boolean } | null>(null);
  const [sqlError, setSqlError] = React.useState<string | null>(null);

  const header = React.useMemo(() => readHeader(head), [head]);

  /* ---- engine load ---- */
  React.useEffect(() => {
    let cancelled = false;
    setErr(null);
    setReady(false);
    if (!arrayBuffer) {
      setErr("File exceeds the in-memory load cap — the database must be fully loaded to run SQLite queries in-browser.");
      return;
    }
    (async () => {
      try {
        const db = await openDatabase(arrayBuffer);
        if (cancelled) { db.close(); return; }
        dbRef.current = db;
        setReady(true);
      } catch (e) {
        if (!cancelled) setErr("SQLite engine failed to load: " + (e instanceof Error ? e.message : String(e)));
      }
    })();
    return () => {
      cancelled = true;
      try { dbRef.current?.close(); } catch { /* ignore */ }
      dbRef.current = null;
    };
  }, [arrayBuffer]);

  /* ---- object list ---- */
  const refreshObjects = React.useCallback(() => {
    const db = dbRef.current;
    if (!db) return;
    try {
      const res = db.exec("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','view','index','trigger') ORDER BY type DESC, name");
      const rows = res[0]?.values ?? [];
      setObjects(rows.map((r) => ({ type: String(r[0]), name: String(r[1]), sql: r[2] == null ? null : String(r[2]) })));
    } catch (e) {
      setErr("sqlite_master unreadable: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  React.useEffect(() => {
    if (ready) refreshObjects();
  }, [ready, refreshObjects]);

  /* ---- table loading ---- */
  const loadTable = React.useCallback((name: string, offset: number, append: boolean) => {
    const db = dbRef.current;
    if (!db) return;
    setTableErr(null);
    setCellSel(null);
    try {
      const safe = name.replace(/"/g, '""');
      const res = db.exec(`SELECT * FROM "${safe}" LIMIT 500 OFFSET ${offset}`);
      const columns = res[0]?.columns ?? [];
      const rows = (res[0]?.values ?? []) as unknown[][];
      const cnt = db.exec(`SELECT COUNT(*) FROM "${safe}"`);
      const total = Number(cnt[0]?.values?.[0]?.[0] ?? 0);
      setCounts((prev) => ({ ...prev, [name]: total }));
      setTable((prev) =>
        append && prev && prev.name === name
          ? { name, columns, rows: [...prev.rows, ...rows], total, offset }
          : { name, columns, rows, total, offset },
      );
    } catch (e) {
      setTable(null);
      setTableErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  function selectObject(o: DbObject) {
    setSelected(o.name);
    setPanel("data");
    if (o.type === "table" || o.type === "view") {
      loadTable(o.name, 0, false);
    } else {
      setTable(null);
    }
  }

  /* ---- SQL console ---- */
  function runQuery() {
    const db = dbRef.current;
    if (!db) return;
    const q = sqlText.trim();
    if (!q) return;
    setSqlError(null);
    setSqlResult(null);
    const lower = q.toLowerCase();
    if (!/^(select|with|pragma|explain)\b/.test(lower)) {
      setSqlError("Read-only console — statements must start with SELECT, WITH, PRAGMA or EXPLAIN.");
      return;
    }
    if (/\b(insert|update|delete|drop|create|alter|attach|detach|replace|vacuum|reindex)\b/.test(lower)) {
      setSqlError("Write operations are rejected — this viewer treats the database as read-only.");
      return;
    }
    const t0 = performance.now();
    try {
      const res = db.exec(q);
      const ms = performance.now() - t0;
      if (res.length && res[0].columns.length) {
        setSqlResult({ columns: res[0].columns, rows: res[0].values.slice(0, 500), ms, truncated: res[0].values.length > 500 });
      } else {
        setSqlResult({ columns: [], rows: [], ms });
      }
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : String(e));
    }
  }

  if (err) {
    return (
      <ErrorCard
        title="Could not open database"
        message={err}
        hint={header ? `Header parsed: ${formatNum(header.pageCount)} pages × ${formatBytes(header.pageSize)}. Use Hex view for raw inspection.` : undefined}
      />
    );
  }
  if (!ready) return <LoadingState label="Booting SQLite (WebAssembly)…" />;

  const selObj = objects.find((o) => o.name === selected) ?? null;
  const tables = objects.filter((o) => o.type === "table");
  const views = objects.filter((o) => o.type === "view");
  const indexes = objects.filter((o) => o.type === "index");
  const triggers = objects.filter((o) => o.type === "trigger");

  const iconFor = (t: string) =>
    t === "table" ? <Table2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" /> :
    t === "view" ? <Eye className="h-3.5 w-3.5 shrink-0 text-teal-500/80" /> :
    t === "index" ? <BarChart3 className="h-3.5 w-3.5 shrink-0 text-amber-500/80" /> :
    <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500/80" />;

  const cellValue = cellSel && table ? table.rows[cellSel.ri]?.[cellSel.ci] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Database className="h-3 w-3" />SQLite</Chip>
            <Chip>{formatNum(tables.length)} tables</Chip>
            {views.length ? <Chip>{formatNum(views.length)} views</Chip> : null}
            {indexes.length ? <Chip>{formatNum(indexes.length)} indexes</Chip> : null}
            {header ? <Chip tone="teal">{formatBytes(header.pageSize)} pages</Chip> : null}
            {header ? <Chip>engine v{header.version}</Chip> : null}
          </>
        }
        right={
          <>
            <Segmented
              value={panel}
              onChange={setPanel}
              options={[
                { value: "data", label: "Data" },
                { value: "sql", label: "SQL" },
              ]}
            />
            <ToolbarDivider />
            <ToolButton label="Refresh" onClick={() => { refreshObjects(); if (selObj) loadTable(selObj.name, 0, false); }} title="Reload schema">
              <RefreshCw className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton
              label="Download"
              title="Download the database file"
              disabled={!arrayBuffer}
              onClick={() => arrayBuffer && downloadBlob(new Uint8Array(arrayBuffer), fileName || "database.sqlite", "application/x-sqlite3")}
            >
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <ViewerBody className="p-3">
        <div className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* sidebar */}
          <div className="min-w-0 space-y-3">
            <SectionCard title="Schema" icon={<Table2 className="h-3.5 w-3.5" />} right={<Chip>{formatNum(objects.length)}</Chip>}>
              {objects.length ? (
                <div className="max-h-[46vh] space-y-0.5 overflow-auto scrollbar-thin">
                  {[
                    { label: "Tables", items: tables },
                    { label: "Views", items: views },
                    { label: "Indexes", items: indexes },
                    { label: "Triggers", items: triggers },
                  ].filter((g) => g.items.length).map((g) => (
                    <div key={g.label} className="mb-2">
                      <div className="px-1 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{g.label}</div>
                      {g.items.map((o) => (
                        <button
                          key={o.type + ":" + o.name}
                          type="button"
                          onClick={() => selectObject(o)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors",
                            selected === o.name ? "bg-emerald-900/30 text-emerald-200" : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                          )}
                        >
                          {iconFor(o.type)}
                          <span className="truncate">{o.name}</span>
                          {counts[o.name] != null ? (
                            <span className="ml-auto shrink-0 tabular-nums text-[10px] text-zinc-500">{formatNum(counts[o.name])}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyHint>No tables, views or indexes found — empty database.</EmptyHint>
              )}
            </SectionCard>

            <SectionCard title="Database info" icon={<FileJson className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="File size">{formatBytes(file.size)}</Field>
                {header ? (
                  <>
                    <Field label="Page size">{formatBytes(header.pageSize)}</Field>
                    <Field label="Pages">{formatNum(header.pageCount)}</Field>
                    <Field label="Computed size">{formatBytes(header.pageCount * header.pageSize)}</Field>
                    <Field label="Text encoding">{header.encoding}</Field>
                    <Field label="Writer mode">{header.writeVer === 2 ? "WAL" : header.writeVer === 1 ? "Legacy (rollback)" : header.writeVer}</Field>
                  </>
                ) : null}
              </InfoGrid>
            </SectionCard>
          </div>

          {/* main */}
          <div className="min-w-0 space-y-3">
            {panel === "data" ? (
              <>
                {!selected ? (
                  <EmptyHint>Select a table or view from the schema sidebar to browse its rows.</EmptyHint>
                ) : selObj && (selObj.type === "index" || selObj.type === "trigger") ? (
                  <SectionCard title={`${selObj.type} — ${selObj.name}`} icon={iconFor(selObj.type)}>
                    {selObj.sql ? (
                      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[11px] text-zinc-300 scrollbar-thin">{selObj.sql}</pre>
                    ) : (
                      <EmptyHint>No DDL recorded (auto-created {selObj.type}).</EmptyHint>
                    )}
                  </SectionCard>
                ) : tableErr ? (
                  <div className="rounded border border-rose-900/50 bg-rose-950/30 p-3 text-xs text-rose-300">{tableErr}</div>
                ) : table ? (
                  <SectionCard
                    title={table.name}
                    icon={<Table2 className="h-3.5 w-3.5" />}
                    right={<Chip tone="teal">{formatNum(table.total)} rows · showing {formatNum(table.rows.length)}</Chip>}
                  >
                    {table.columns.length ? (
                      <>
                        <div className="max-h-[52vh] overflow-auto rounded border border-zinc-800 scrollbar-thin">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                              <tr>
                                <th className="px-2 py-2 text-left font-medium">#</th>
                                {table.columns.map((c) => (
                                  <th key={c} className="whitespace-nowrap px-2 py-2 text-left font-medium">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {table.rows.map((row, ri) => (
                                <tr key={ri} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-zinc-600">{table.offset + ri + 1}</td>
                                  {row.map((cell, ci) => (
                                    <td
                                      key={ci}
                                      onClick={() => setCellSel(cellSel && cellSel.ri === ri && cellSel.ci === ci ? null : { ri, ci })}
                                      title="Click to inspect the full value"
                                      className={cn(
                                        "max-w-[260px] cursor-pointer truncate px-2 py-1 text-zinc-300",
                                        cellSel && cellSel.ri === ri && cellSel.ci === ci && "bg-emerald-900/25 text-emerald-200",
                                      )}
                                    >
                                      {renderCell(cell)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {table.total > table.rows.length ? (
                          <div className="pt-3">
                            <ToolButton
                              onClick={() => loadTable(table.name, table.rows.length, true)}
                              label={`Load 500 more rows (${formatNum(table.total - table.rows.length)} hidden)`}
                              className="w-full justify-center border border-zinc-800"
                            >
                              <Binary className="h-3.5 w-3.5" />
                            </ToolButton>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <EmptyHint>“{table.name}” has no columns (empty result set).</EmptyHint>
                    )}
                  </SectionCard>
                ) : (
                  <LoadingState label={`Loading ${selected}…`} />
                )}

                {cellSel && table && cellValue !== undefined ? (
                  <SectionCard
                    title={`${table.columns[cellSel.ci]} · row ${table.offset + cellSel.ri + 1}`}
                    icon={<Eye className="h-3.5 w-3.5" />}
                    right={
                      <div className="flex items-center gap-1">
                        {cellValue instanceof Uint8Array ? (
                          <ToolButton
                            label="Save blob"
                            onClick={() => downloadBlob(cellValue.slice(), `blob-r${table.offset + cellSel.ri + 1}-c${cellSel.ci}.bin`, "application/octet-stream")}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </ToolButton>
                        ) : null}
                        <ToolButton onClick={() => setCellSel(null)} title="Close"><X className="h-3.5 w-3.5" /></ToolButton>
                      </div>
                    }
                  >
                    <InfoGrid className="mb-2">
                      <Field label="Type">{cellKind(cellValue)}</Field>
                      <Field label="Size">{cellValue instanceof Uint8Array ? `${formatNum(cellValue.length)} bytes` : cellValue === null ? "—" : `${String(cellValue).length} chars`}</Field>
                    </InfoGrid>
                    {cellValue instanceof Uint8Array ? (
                      <div className="max-h-[30vh] overflow-auto rounded border border-zinc-800 bg-zinc-950/60 p-2 font-mono text-[10px] text-zinc-400 scrollbar-thin">
                        {Array.from({ length: Math.min(Math.ceil(cellValue.length / 16), 256) }, (_, i) => (
                          <div key={i} className="whitespace-pre">{hexDumpLine(cellValue.subarray(i * 16, i * 16 + 16), i * 16)}</div>
                        ))}
                        {cellValue.length > 4096 ? <div className="whitespace-pre text-zinc-600">… ({formatBytes(cellValue.length)} total)</div> : null}
                      </div>
                    ) : cellValue === null ? (
                      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs italic text-zinc-500">NULL</div>
                    ) : (
                      <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-300 scrollbar-thin">
                        {String(cellValue).length > 100000 ? String(cellValue).slice(0, 100000) + "\n… (truncated at 100 KB)" : String(cellValue)}
                      </pre>
                    )}
                  </SectionCard>
                ) : null}
              </>
            ) : (
              <SectionCard
                title="SQL console — read-only"
                icon={<Terminal className="h-3.5 w-3.5" />}
                right={
                  <ToolButton label="Run" onClick={runQuery} title="Execute (Enter)">
                    <Play className="h-3.5 w-3.5" />
                  </ToolButton>
                }
              >
                <input
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runQuery(); }}
                  spellCheck={false}
                  placeholder="SELECT name, type FROM sqlite_master LIMIT 20"
                  className="w-full rounded border border-zinc-700 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-700"
                />
                <p className="mt-2 text-[11px] text-zinc-500">
                  Only SELECT / WITH / PRAGMA / EXPLAIN statements are accepted. Results are capped at 500 rows. Press Enter to run.
                </p>
                {sqlError ? (
                  <div className="mt-3 rounded border border-rose-900/50 bg-rose-950/30 p-3 font-mono text-[11px] text-rose-300">{sqlError}</div>
                ) : null}
                {sqlResult ? (
                  <div className="mt-3">
                    {sqlResult.columns.length ? (
                      <>
                        <div className="mb-2 flex items-center gap-2">
                          <Chip tone="teal">{formatNum(sqlResult.rows.length)} rows</Chip>
                          <Chip>{sqlResult.ms.toFixed(1)} ms</Chip>
                          {sqlResult.truncated ? <Chip tone="amber">capped at 500</Chip> : null}
                        </div>
                        <div className="max-h-[46vh] overflow-auto rounded border border-zinc-800 scrollbar-thin">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                              <tr>
                                {sqlResult.columns.map((c) => (
                                  <th key={c} className="whitespace-nowrap px-2 py-2 text-left font-medium">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sqlResult.rows.map((row, ri) => (
                                <tr key={ri} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                                  {row.map((cell, ci) => (
                                    <td key={ci} className="max-w-[260px] truncate px-2 py-1 text-zinc-300">{renderCell(cell)}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
                        Statement executed in {sqlResult.ms.toFixed(1)} ms — no rows returned.
                      </div>
                    )}
                  </div>
                ) : null}
              </SectionCard>
            )}
          </div>
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Database className="h-3.5 w-3.5" />
        <span className="truncate">
          {detected.name} · {formatBytes(file.size)} · sql.js runs entirely in your browser{header ? ` · ${formatNum(header.pageCount)} pages × ${formatBytes(header.pageSize)}` : ""}
        </span>
      </div>
    </div>
  );
}
