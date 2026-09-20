"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EXPLORER_ROWS, FORMAT_STATS } from "@/lib/formats/stats";
import { CATEGORY_LABELS } from "@/lib/formats";
import type { FormatCategory } from "@/lib/types";
import { cn, formatNum } from "@/lib/utils";
import { Search, ChevronRight, Package, Boxes, Hash, FileCode2 } from "lucide-react";

const ROW_H = 52;

const KIND_META: Record<string, { label: string; cls: string }> = {
  format: { label: "ext", cls: "border-emerald-900/60 bg-emerald-950/40 text-emerald-300" },
  mime: { label: "mime", cls: "border-teal-900/60 bg-teal-950/40 text-teal-300" },
  encoding: { label: "charset", cls: "border-amber-900/60 bg-amber-950/40 text-amber-300" },
};

export function FormatExplorer({
  open, onOpenChange, initialCat,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialCat?: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [cat, setCat] = React.useState<string | "all">("all");
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(520);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) {
      setCat(initialCat ?? "all");
      setQuery("");
      setScrollTop(0);
      if (listRef.current) listRef.current.scrollTop = 0;
    }
  }, [open, initialCat]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\./, "");
    return EXPLORER_ROWS.filter((r) => {
      if (cat !== "all" && r.cat !== cat) return false;
      if (!q) return true;
      return (
        r.label.toLowerCase().includes(q) ||
        r.sub.toLowerCase().includes(q) ||
        r.cat.toLowerCase().includes(q) ||
        (r.desc?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [query, cat]);

  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, [open]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const count = Math.ceil(viewportH / ROW_H) + 12;
  const visible = filtered.slice(first, first + count);

  const cats = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of EXPLORER_ROWS) s.add(r.cat);
    return [...s].sort();
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-3xl gap-0 overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-zinc-200 sm:max-w-3xl"
      >
        <DialogHeader className="border-b border-zinc-800 px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Boxes className="h-4 w-4 text-emerald-400" />
            Format registry
            <span className="ml-2 font-mono text-[11px] font-normal text-zinc-500">
              {formatNum(EXPLORER_ROWS.length)} entries · {formatNum(FORMAT_STATS.signatures)} signatures
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
              placeholder="Search extension, format name, MIME…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {query ? <span className="shrink-0 font-mono text-[10px] text-emerald-400">{formatNum(filtered.length)}</span> : null}
          </div>
          <select
            value={cat}
            onChange={(e) => { setCat(e.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
            className="h-8 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300 outline-none"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {cats.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
        </div>

        <div
          ref={listRef}
          onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          className="h-[60vh] overflow-y-auto scrollbar-thin"
        >
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500">
              No formats match <span className="font-mono text-zinc-300">{query}</span>.
              Drop the file anyway — unknown formats fall back to the forensic hex view.
            </div>
          ) : (
            <div className="relative" style={{ height: filtered.length * ROW_H }}>
              <div className="absolute inset-x-0 top-0" style={{ transform: `translateY(${first * ROW_H}px)` }}>
                {visible.map((r, i) => (
                  <div
                    key={r.key}
                    style={{ height: ROW_H }}
                    className="flex items-center gap-3 border-b border-zinc-800/50 px-4 transition-colors hover:bg-zinc-900/60"
                  >
                    <span className={cn("w-24 shrink-0 truncate rounded border px-1.5 py-0.5 text-center font-mono text-[11px]", KIND_META[r.kind].cls)}>
                      {r.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-zinc-200">{r.sub}</div>
                      {r.desc ? <div className="truncate text-[10px] text-zinc-500">{r.desc}</div> : null}
                    </div>
                    <span className="hidden shrink-0 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 sm:inline">
                      {CATEGORY_LABELS[r.cat as FormatCategory] ?? r.cat}
                    </span>
                    <span className="hidden w-20 shrink-0 items-center gap-1 text-[10px] text-zinc-500 md:flex">
                    <FileCode2 className="h-3 w-3" /> {r.viewer}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-zinc-800 bg-zinc-900/40 px-4 py-2 text-[10px] text-zinc-500">
          <span className="inline-flex items-center gap-1"><Package className="h-3 w-3" /> virtualized list</span>
          <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> {formatNum(FORMAT_STATS.formats)} format records</span>
          <span className="ml-auto inline-flex items-center gap-1">
            open any file anyway <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
