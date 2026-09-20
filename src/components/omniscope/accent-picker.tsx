"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Palette, Check, Sparkles } from "lucide-react";
import { ACCENTS, applyAccent, readAccent, type AccentDef } from "@/lib/accent";
import { cn } from "@/lib/utils";

interface AccentPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Header popover for the accent theme system (9 palettes).
 * Recolors the entire app by flipping `html[data-accent]`, which redefines
 * the Tailwind `--color-emerald-*` variable family — see globals.css.
 */
export function AccentPicker({ open, onOpenChange }: AccentPickerProps) {
  const [accent, setAccent] = React.useState<string>("emerald");
  const rootRef = React.useRef<HTMLDivElement>(null);

  /* initial value from storage once mounted (pre-paint script already applied it) */
  React.useEffect(() => {
    setAccent(readAccent());
  }, []);

  /* close on outside click */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  /* Esc closes (capture so the app-level handler doesn't also fire) */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onOpenChange]);

  const pick = (a: AccentDef) => {
    setAccent(a.id);
    applyAccent(a.id);
    onOpenChange(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 transition-colors hover:border-emerald-700 hover:text-emerald-300",
          open && "border-emerald-700 bg-emerald-950/40 text-emerald-300",
        )}
        title="Accent color (A)"
        aria-label="Accent color"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          role="menu"
          aria-label="Accent themes"
          className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/60"
        >
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3.5 py-2.5">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <span className="text-xs font-semibold text-zinc-200">Accent theme</span>
            <span className="ml-auto font-mono text-[10px] text-zinc-500">
              {accent === "emerald" ? "default" : accent}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 p-3">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitemradio"
                aria-checked={accent === a.id}
                onClick={() => pick(a)}
                className={cn(
                  "group flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 transition-colors",
                  accent === a.id
                    ? "border-emerald-800/60 bg-emerald-950/30"
                    : "border-transparent hover:border-zinc-700 hover:bg-zinc-900/60",
                )}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full border border-black/40 shadow-inner shadow-black/30 transition-transform",
                      accent === a.id && "h-5 w-5 ring-2 ring-emerald-400/80 ring-offset-2 ring-offset-zinc-950",
                    )}
                    style={{ backgroundColor: a.swatch }}
                    aria-hidden
                  />
                  {accent === a.id ? (
                    <Check className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-emerald-600 p-[3px] text-white shadow" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    accent === a.id ? "text-emerald-300" : "text-zinc-400 group-hover:text-zinc-200",
                  )}
                >
                  {a.label}
                </span>
              </button>
            ))}
          </div>

          <p className="border-t border-zinc-800 bg-zinc-900/40 px-3.5 py-2 text-[10px] leading-relaxed text-zinc-400">
            Recolors every panel, chart &amp; highlight instantly — remembered across visits.
          </p>
        </motion.div>
      ) : null}
    </div>
  );
}

export default AccentPicker;
