"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, Segmented, ToolButton,
} from "./viewer-ui";
import { cn, formatBytes, formatNum } from "@/lib/utils";
import { asciiAt } from "@/lib/binary";
import { Boxes, FileInput, FileOutput, ChevronDown, Info, Braces } from "lucide-react";

/* ================================ model ================================ */

interface WasmSection { id: number; name: string; size: number; count: number | null; custom?: string; }
interface WasmImport { module: string; field: string; kind: string; }
interface WasmExport { name: string; kind: string; index: number; }

interface WasmModel {
  version: string;
  sections: WasmSection[];
  imports: WasmImport[];
  exports: WasmExport[];
  moduleName: string | null;
  funcNames: Map<number, string>;
  funcCount: number | null;
  importFuncCount: number;
  notes: string[];
}

const SECTION_NAMES: Record<number, string> = {
  0: "Custom", 1: "Type", 2: "Import", 3: "Function", 4: "Table", 5: "Memory", 6: "Global",
  7: "Export", 8: "Start", 9: "Elem", 10: "Code", 11: "Data", 12: "DataCount", 13: "Tag",
};

const KIND_TONES: Record<string, "zinc" | "emerald" | "amber" | "teal" | "violet"> = {
  func: "emerald", table: "teal", memory: "amber", global: "violet", tag: "zinc",
};

const TD = new TextDecoder();

/* ============================== LEB helpers ============================== */

function readUleb(b: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 1;
  for (;;) {
    const byte = b[pos];
    if (byte === undefined) throw new Error("unexpected end of data");
    result += (byte & 0x7f) * shift;
    pos++;
    if ((byte & 0x80) === 0) break;
    shift *= 128;
    if (shift > 2 ** 63) throw new Error("LEB128 sequence too long");
  }
  return [result, pos];
}

function readWasmName(b: Uint8Array, pos: number): [string, number] {
  const [len, p] = readUleb(b, pos);
  const end = p + len;
  if (len < 0 || end > b.length) throw new Error("name extends beyond bounds");
  return [TD.decode(b.subarray(p, end)), end];
}

function skipLimits(b: Uint8Array, pos: number): number {
  const flags = b[pos];
  if (flags === undefined) throw new Error("unexpected end of data");
  pos++;
  pos = readUleb(b, pos)[1]; // min
  if (flags & 1) pos = readUleb(b, pos)[1]; // max
  return pos;
}

/* =============================== parsers =============================== */

function parseImports(b: Uint8Array, start: number, end: number): WasmImport[] {
  const out: WasmImport[] = [];
  let [count, p] = readUleb(b, start);
  for (let i = 0; i < count && p < end; i++) {
    const [mod, p1] = readWasmName(b, p);
    const [field, p2] = readWasmName(b, p1);
    p = p2;
    const kind = b[p];
    p++;
    let kindName: string;
    switch (kind) {
      case 0: { p = readUleb(b, p)[1]; kindName = "func"; break; }
      case 1: { p++; p = skipLimits(b, p); kindName = "table"; break; }
      case 2: { p = skipLimits(b, p); kindName = "memory"; break; }
      case 3: { p += 2; kindName = "global"; break; }
      case 4: { p++; p = readUleb(b, p)[1]; kindName = "tag"; break; }
      default: throw new Error(`unknown import kind ${kind}`);
    }
    out.push({ module: mod, field, kind: kindName });
  }
  return out;
}

function parseExports(b: Uint8Array, start: number, end: number): WasmExport[] {
  const out: WasmExport[] = [];
  let [count, p] = readUleb(b, start);
  const kinds = ["func", "table", "memory", "global", "tag"];
  for (let i = 0; i < count && p < end; i++) {
    const [name, p1] = readWasmName(b, p);
    const kind = b[p1];
    const [index, p2] = readUleb(b, p1 + 1);
    out.push({ name, kind: kinds[kind] ?? `kind${kind}`, index });
    p = p2;
  }
  return out;
}

function parseNameSection(b: Uint8Array, start: number, end: number): { moduleName: string | null; funcNames: Map<number, string> } {
  let moduleName: string | null = null;
  const funcNames = new Map<number, string>();
  let p = start;
  while (p < end) {
    const subId = b[p];
    p++;
    const [subSize, p2] = readUleb(b, p);
    p = p2;
    const subEnd = Math.min(p + subSize, end);
    if (subId === 0) {
      const [nm, q] = readWasmName(b, p);
      if (q <= subEnd) moduleName = nm;
    } else if (subId === 1) {
      let [count, q] = readUleb(b, p);
      for (let i = 0; i < count && q < subEnd; i++) {
        const [idx, q1] = readUleb(b, q);
        const [nm, q2] = readWasmName(b, q1);
        funcNames.set(idx, nm);
        q = q2;
      }
    }
    p = subEnd;
  }
  return { moduleName, funcNames };
}

function parseWasm(b: Uint8Array): WasmModel {
  if (b.length < 8 || asciiAt(b, 0, 4) !== "\0asm") {
    throw new Error("WebAssembly magic (00 61 73 6D) missing.");
  }
  const version = `${b[4]}.${b[5]}.${b[6]}.${b[7]}`;
  const sections: WasmSection[] = [];
  let imports: WasmImport[] = [];
  let exports: WasmExport[] = [];
  let moduleName: string | null = null;
  let funcNames = new Map<number, string>();
  let funcCount: number | null = null;
  const notes: string[] = [];

  let p = 8;
  while (p < b.length) {
    const id = b[p];
    p++;
    const [size, p2] = readUleb(b, p);
    p = p2;
    const start = p;
    const end = start + size;
    if (end > b.length) {
      notes.push("The last section is truncated — its payload may be incomplete.");
      break;
    }
    let count: number | null = null;
    let custom: string | undefined;
    if (id === 0) {
      try {
        const [nm, q] = readWasmName(b, start);
        custom = nm;
        if (nm === "name") {
          const r = parseNameSection(b, q, end);
          moduleName = r.moduleName;
          funcNames = r.funcNames;
        }
      } catch {
        custom = "<unreadable>";
      }
    } else if (id !== 8) {
      // every section except Start begins with a vector count (or single value)
      try {
        count = readUleb(b, start)[0];
      } catch {
        count = null;
      }
    }
    sections.push({ id, name: SECTION_NAMES[id] ?? `Unknown ${id}`, size, count, custom });
    if (id === 2) {
      try { imports = parseImports(b, start, end); } catch { notes.push("Import section could not be fully decoded."); }
    }
    if (id === 7) {
      try { exports = parseExports(b, start, end); } catch { notes.push("Export section could not be fully decoded."); }
    }
    if (id === 10) funcCount = count;
    p = end;
  }
  const importFuncCount = imports.filter((i) => i.kind === "func").length;
  if (!sections.length) notes.push("No sections found — the module is empty.");
  return { version, sections, imports, exports, moduleName, funcNames, funcCount, importFuncCount, notes };
}

/* ================================ viewer ================================ */

export default function WasmViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [model, setModel] = React.useState<WasmModel | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [panel, setPanel] = React.useState<"sections" | "imports" | "exports">("sections");
  const [visible, setVisible] = React.useState(500);

  React.useEffect(() => {
    setErr(null);
    setModel(null);
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      setModel(parseWasm(bytes));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  React.useEffect(() => { setVisible(500); }, [panel]);

  if (err) return <ErrorCard title="Could not parse WebAssembly" message={err} />;
  if (!model) return <LoadingState label="Parsing WASM sections…" />;

  const maxSection = Math.max(1, ...model.sections.map((s) => s.size));
  const exportFns = new Set(model.exports.filter((e) => e.kind === "func").map((e) => e.index));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Boxes className="h-3 w-3" />WebAssembly</Chip>
            <Chip>version {model.version}</Chip>
            <Chip>{formatNum(model.sections.length)} sections</Chip>
            {model.imports.length ? <Chip>{formatNum(model.imports.length)} imports</Chip> : null}
            {model.exports.length ? <Chip tone="teal">{formatNum(model.exports.length)} exports</Chip> : null}
            {model.moduleName ? <Chip tone="violet">{model.moduleName}</Chip> : null}
          </>
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "sections", label: "Sections" },
              { value: "imports", label: "Imports" },
              { value: "exports", label: "Exports" },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {panel === "sections" ? (
            <>
              <SectionCard title="Module overview" icon={<Info className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  <Field label="Binary version">{model.version}</Field>
                  <Field label="Module name">{model.moduleName ?? "— (no name section)"}</Field>
                  <Field label="Sections">{formatNum(model.sections.length)}</Field>
                  <Field label="Functions">
                    {model.importFuncCount} imported + {model.funcCount != null ? formatNum(model.funcCount) : "?"} defined
                  </Field>
                  <Field label="Named functions">{model.funcNames.size ? `${formatNum(model.funcNames.size)} (name section present)` : "0 (stripped)"}</Field>
                  <Field label="File size">{formatBytes(file.size)}</Field>
                </InfoGrid>
                <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] leading-relaxed text-zinc-500">
                  A “name” section is optional debug info — without it, functions are only addressable by index and the module is
                  effectively minified.
                </p>
              </SectionCard>
              <SectionCard title="Section table" icon={<Braces className="h-3.5 w-3.5" />}>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">ID</th>
                        <th className="py-1 pr-2 font-medium">Section</th>
                        <th className="py-1 pr-2 font-medium">Payload</th>
                        <th className="py-1 pr-2 font-medium">Size</th>
                        <th className="py-1 font-medium">Entries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.sections.map((s, i) => (
                        <tr key={i} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                          <td className="py-1.5 pr-2 font-mono text-zinc-500">{s.id}</td>
                          <td className="py-1.5 pr-2 text-zinc-200">
                            {s.name}
                            {s.custom ? <span className="ml-2 font-mono text-[10px] text-violet-300/80">“{s.custom}”</span> : null}
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className={cn("h-full rounded-full", s.id === 10 ? "bg-emerald-500" : "bg-zinc-500")}
                                style={{ width: `${Math.max(2, (s.size / maxSection) * 100)}%` }}
                              />
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.size)}</td>
                          <td className="py-1.5 tabular-nums text-zinc-400">{s.count != null ? formatNum(s.count) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          ) : null}

          {panel === "imports" ? (
            <SectionCard title="Imports" icon={<FileInput className="h-3.5 w-3.5" />} right={<Chip>{formatNum(model.imports.length)}</Chip>}>
              {model.imports.length ? (
                <>
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Module</th>
                          <th className="py-1 pr-2 font-medium">Field</th>
                          <th className="py-1 pr-2 font-medium">Kind</th>
                          <th className="py-1 font-medium">Imported name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.imports.slice(0, visible).map((im, i) => {
                          let fnName = "";
                          if (im.kind === "func") {
                            let funcIdx = 0;
                            for (let j = 0; j < i; j++) if (model.imports[j].kind === "func") funcIdx++;
                            fnName = model.funcNames.get(funcIdx) ?? "";
                          }
                          return (
                            <tr key={i} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                              <td className="py-1.5 pr-2 font-mono text-emerald-300">{im.module}</td>
                              <td className="py-1.5 pr-2 font-mono text-zinc-300">{im.field}</td>
                              <td className="py-1.5 pr-2"><Chip tone={KIND_TONES[im.kind] ?? "zinc"}>{im.kind}</Chip></td>
                              <td className="py-1.5 font-mono text-[10px] text-zinc-500">{fnName || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {model.imports.length > visible ? <ShowMore remaining={model.imports.length - visible} onMore={() => setVisible((v) => v + 500)} /> : null}
                </>
              ) : (
                <EmptyHint>No import section — the module is fully self-contained.</EmptyHint>
              )}
            </SectionCard>
          ) : null}

          {panel === "exports" ? (
            <SectionCard title="Exports" icon={<FileOutput className="h-3.5 w-3.5" />} right={<Chip tone="teal">{formatNum(model.exports.length)}</Chip>}>
              {model.exports.length ? (
                <>
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Name</th>
                          <th className="py-1 pr-2 font-medium">Kind</th>
                          <th className="py-1 pr-2 text-right font-medium">Index</th>
                          <th className="py-1 font-medium">Function name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.exports.slice(0, visible).map((ex, i) => {
                          const fn = ex.kind === "func" ? model.funcNames.get(ex.index) : undefined;
                          return (
                            <tr key={i} className={cn("border-t border-zinc-800/60 hover:bg-zinc-900/40", exportFns.has(ex.index) && ex.kind === "func" && "bg-emerald-950/10")}>
                              <td className="py-1.5 pr-2 font-mono text-emerald-300">{ex.name}</td>
                              <td className="py-1.5 pr-2"><Chip tone={KIND_TONES[ex.kind] ?? "zinc"}>{ex.kind}</Chip></td>
                              <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatNum(ex.index)}</td>
                              <td className="py-1.5 font-mono text-[10px] text-zinc-500">{fn ?? "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {model.exports.length > visible ? <ShowMore remaining={model.exports.length - visible} onMore={() => setVisible((v) => v + 500)} /> : null}
                </>
              ) : (
                <EmptyHint>No export section — the module exposes nothing to its host.</EmptyHint>
              )}
            </SectionCard>
          ) : null}

          {model.notes.length ? (
            <div className="space-y-1">
              {model.notes.map((n, i) => (
                <div key={i} className="rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300/90">{n}</div>
              ))}
            </div>
          ) : null}
          {!arrayBuffer ? (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] leading-relaxed text-zinc-500">
              Parsed from the first 64 KB only (file exceeds the in-memory load cap) — later sections may be missing.
            </div>
          ) : null}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Boxes className="h-3.5 w-3.5" />
        <span className="truncate">{detected.name} · {formatBytes(file.size)} · {fileName}</span>
      </div>
    </div>
  );
}

function ShowMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  return (
    <div className="pt-3">
      <ToolButton onClick={onMore} label={`Show 500 more (${formatNum(remaining)} hidden)`} className="w-full justify-center border border-zinc-800">
        <ChevronDown className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  );
}
