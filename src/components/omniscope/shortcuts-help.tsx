"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Keyboard, X, UploadCloud, FileSearch, GitCompare, GitBranch, Combine, PanelLeft, MousePointer2,
  ClipboardPaste, CornerDownLeft, Home, Eye, Table2, FolderDown, ListChecks, Palette, FileText,
} from "lucide-react";

interface ShortcutRow {
  keys: string[];
  label: string;
  hint?: string;
}

const GROUPS: { title: string; icon: React.ReactNode; rows: ShortcutRow[] }[] = [
  {
    title: "Global",
    icon: <Keyboard className="h-3.5 w-3.5" />,
    rows: [
      { keys: ["Ctrl", "O"], label: "Open file picker", hint: "⌘ O on Mac" },
      { keys: ["Ctrl", "K"], label: "Format explorer", hint: "10,014 formats, searchable" },
      { keys: ["Ctrl", "D"], label: "Compare view", hint: "byte & text diff — press again to exit" },
      { keys: ["?"], label: "This shortcut sheet" },
      { keys: ["A"], label: "Accent color picker", hint: "9 themes — recolors everything, remembered" },
      { keys: ["Esc"], label: "Close / go back", hint: "explorer → joiner → compare → active tab" },
    ],
  },
  {
    title: "Files & tabs",
    icon: <UploadCloud className="h-3.5 w-3.5" />,
    rows: [
      { keys: ["Drag", "drop"], label: "Open files anywhere on the page", hint: "multiple files welcome" },
      { keys: ["Ctrl", "V"], label: "Paste files from clipboard", hint: "screenshots, copied files" },
      { keys: ["Click", "tab"], label: "Switch between open files" },
      { keys: ["Esc"], label: "Close active tab" },
      { keys: ["Home", "logo"], label: "Back to landing page", hint: "tabs stay open" },
    ],
  },
  {
    title: "Tools",
    icon: <MousePointer2 className="h-3.5 w-3.5" />,
    rows: [
      { keys: ["Join"], label: "Merge split archives", hint: ".001 · .r00 · .partN.rar · .z01 sets" },
      { keys: ["Compare"], label: "A/B slots with swap, patch export", hint: "auto-detects text vs bytes" },
      { keys: ["GitBranch"], label: "3-way merge mode", hint: "base + mine + theirs → conflicts, merged export" },
      { keys: ["n"], label: "Next change block (text compare)", hint: "amber ring marks the active block; conflicts in 3-way" },
      { keys: ["p"], label: "Previous change block (text compare)" },
      { keys: ["a"], label: "Resolve focused conflict: mine", hint: "3-way mode — keeps side A, jumps to the next conflict" },
      { keys: ["b"], label: "Resolve focused conflict: theirs", hint: "3-way mode — keeps side B, jumps to the next conflict" },
      { keys: ["u"], label: "Undo the focused conflict's choice", hint: "3-way mode — clears the per-block resolution" },
      { keys: ["PanelLeft"], label: "Toggle info sidebar", hint: "hashes, entropy, sum-file checks across every open tab — click a verdict row to jump to its tab" },
      { keys: ["FolderDown"], label: "Drop a whole folder", hint: "files open recursively (24 per drop)" },
      { keys: ["ListChecks"], label: "Archive bulk extract", hint: "tick entries → download or re-pack as .zip" },
      { keys: ["FileText"], label: "Batch forensic report", hint: "hash + document every open file in one HTML" },
      { keys: ["Drag"], label: "Drag archive entries out", hint: "drag a row to save it — tick several first and one drag takes them all as a zip" },
    ],
  },
  {
    title: "Viewers",
    icon: <Eye className="h-3.5 w-3.5" />,
    rows: [
      { keys: ["Viewer", "menu"], label: "Force any viewer for any file", hint: "hex, text, image… 39 engines" },
      { keys: ["Table2"], label: "Tables sort & filter", hint: "CSV, XLSX, DBF viewers" },
      { keys: ["Copy"], label: "Copy buttons everywhere", hint: "text, hashes, summaries, patches" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 px-1.5 font-mono text-[10px] font-medium text-zinc-200 shadow-[0_1.5px_0_rgba(0,0,0,0.6)]">
      {children}
    </kbd>
  );
}

function keysToNodes(keys: string[]): React.ReactNode {
  // map special words to icons, everything else renders as kbd
  const iconMap: Record<string, React.ReactNode> = {
    Drag: <MousePointer2 className="h-3 w-3" />,
    drop: <CornerDownLeft className="h-3 w-3" />,
    Click: <MousePointer2 className="h-3 w-3" />,
    tab: <Table2 className="h-3 w-3" />,
    Home: <Home className="h-3 w-3" />,
    logo: <span className="text-[9px] text-zinc-400">logo</span>,
    Join: <Combine className="h-3 w-3" />,
    Compare: <GitCompare className="h-3 w-3" />,
    GitBranch: <GitBranch className="h-3 w-3" />,
    FolderDown: <FolderDown className="h-3 w-3" />,
    ListChecks: <ListChecks className="h-3 w-3" />,
    FileText: <FileText className="h-3 w-3" />,
    PanelLeft: <PanelLeft className="h-3 w-3" />,
    Viewer: <Eye className="h-3 w-3" />,
    menu: <span className="text-[9px] text-zinc-400">menu</span>,
    Table2: <Table2 className="h-3 w-3" />,
    Copy: <ClipboardPaste className="h-3 w-3" />,
  };
  return (
    <>
      {keys.map((k, i) => (
        <React.Fragment key={k + i}>
          {i > 0 ? <span className="text-[10px] text-zinc-600">+</span> : null}
          {iconMap[k] ? (
            <span className="inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 shadow-[0_1.5px_0_rgba(0,0,0,0.6)]">
              {iconMap[k]}
            </span>
          ) : (
            <Kbd>{k}</Kbd>
          )}
        </React.Fragment>
      ))}
    </>
  );
}

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* Esc closes (capture phase so the app-level handler doesn't also fire) */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800 bg-zinc-900/60 px-5 py-3.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-900/60 bg-emerald-950/40 text-emerald-300">
            <Keyboard className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Keyboard &amp; gestures</h2>
            <p className="text-[10px] text-zinc-500">everything runs client-side — nothing is uploaded</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-zinc-700 bg-zinc-900 p-1.5 text-zinc-400 transition-colors hover:border-rose-800 hover:text-rose-300"
            aria-label="Close shortcuts"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="grid gap-5 overflow-y-auto p-5 scrollbar-thin sm:grid-cols-2">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                {g.icon}
                {g.title}
              </h3>
              <ul className="space-y-1">
                {g.rows.map((r) => (
                  <li
                    key={r.label}
                    className="flex items-center gap-3 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-zinc-800 hover:bg-zinc-900/50"
                  >
                    <span className="flex shrink-0 items-center gap-1">{keysToNodes(r.keys)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-zinc-200">{r.label}</span>
                      {r.hint ? <span className="block truncate text-[10px] text-zinc-500">{r.hint}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/40 px-5 py-2.5 text-[10px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          Omniscope universal file lab — press <Kbd>?</Kbd> anytime to reopen this sheet
        </footer>
      </motion.div>
    </div>
  );
}

export default ShortcutsHelp;
