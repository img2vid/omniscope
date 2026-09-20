"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";

/* ------------------------------ toolbar ------------------------------ */

export function ViewerToolbar({
  left,
  center,
  right,
  className,
}: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900/70 px-2 backdrop-blur",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto scrollbar-thin">{left}</div>
      {center ? <div className="flex flex-1 items-center justify-center gap-1.5 overflow-hidden">{center}</div> : <div className="flex-1" />}
      <div className="flex items-center gap-1.5">{right}</div>
    </div>
  );
}

export function ToolButton({
  children,
  label,
  active,
  disabled,
  onClick,
  className,
  title,
}: {
  children: React.ReactNode;
  label?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-zinc-400 transition-[colors,transform] duration-100",
        "hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500",
        "active:scale-95",
        active && "om-chip-active border-emerald-800/60 bg-emerald-900/40 text-emerald-300",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
        className,
      )}
    >
      {children}
      {label ? <span className="hidden sm:inline">{label}</span> : null}
    </button>
  );
}

export function ToolbarDivider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-zinc-700/70" aria-hidden />;
}

export function ToolbarSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-300">
      {label ? <span className="text-zinc-500">{label}</span> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[11rem] cursor-pointer bg-transparent text-xs text-zinc-200 outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-zinc-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------ body ------------------------------ */

export function ViewerBody({
  children,
  className,
  onScroll,
  scrollRef,
}: {
  children: React.ReactNode;
  className?: string;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={cn("min-h-0 flex-1 overflow-auto scrollbar-thin bg-zinc-950/60", className)}
    >
      {children}
    </div>
  );
}

/* ------------------------------ cards / states ------------------------------ */

export function ErrorCard({ title, message, hint }: { title: string; message?: string; hint?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-rose-900/50 bg-rose-950/30 p-5 text-center">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
        <div className="text-sm font-semibold text-rose-200">{title}</div>
        {message ? <div className="mt-1 break-words text-xs text-rose-300/80">{message}</div> : null}
        {hint ? <div className="mt-3 text-xs text-zinc-400">{hint}</div> : null}
      </div>
    </div>
  );
}

export function LoadingState({ label = "Parsing…" }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
      {label}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="p-4 text-center text-xs text-zinc-500">{children}</div>;
}

/* ------------------------------ info widgets ------------------------------ */

export function Chip({
  children,
  tone = "zinc",
  className,
}: {
  children: React.ReactNode;
  tone?: "zinc" | "emerald" | "amber" | "rose" | "violet" | "teal";
  className?: string;
}) {
  const tones: Record<string, string> = {
    zinc: "border-zinc-700 bg-zinc-800/60 text-zinc-300",
    emerald: "border-emerald-800/60 bg-emerald-900/30 text-emerald-300",
    amber: "border-amber-800/60 bg-amber-900/30 text-amber-300",
    rose: "border-rose-800/60 bg-rose-900/30 text-rose-300",
    violet: "border-violet-800/60 bg-violet-900/30 text-violet-300",
    teal: "border-teal-800/60 bg-teal-900/30 text-teal-300",
  };
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function InfoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  /* fixed label column keeps every section's value column on one vertical line */
  return <div className={cn("grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-xs", className)}>{children}</div>;
}

export function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <React.Fragment>
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className={cn("min-w-0 break-words text-zinc-100", mono && "font-mono text-[11px] text-zinc-200")}>{children}</div>
    </React.Fragment>
  );
}

export function Copyable({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      className={cn(
        "group inline-flex min-w-0 items-center gap-1 text-left text-zinc-200 transition-colors hover:text-emerald-300",
        className,
      )}
      title="Copy"
    >
      <span className={cn("min-w-0 break-all", className)}>{value}</span>
      {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-400" /> : <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />}
    </button>
  );
}

export function SectionCard({
  title,
  icon,
  children,
  right,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {icon}
          {title}
        </div>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

/* ------------------------------ segmented ------------------------------ */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-md border border-zinc-700 bg-zinc-900 p-0.5", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-[colors,transform] duration-100 active:scale-95 focus-visible:outline focus-visible:outline-1 focus-visible:outline-emerald-500",
            value === o.value ? "om-seg-active bg-emerald-900/60 text-emerald-200" : "text-zinc-400 hover:text-zinc-200",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
