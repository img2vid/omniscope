"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { FORMAT_STATS } from "@/lib/formats/stats";
import { CATEGORY_LABELS } from "@/lib/formats";
import { makeSamples, type SampleFile } from "@/lib/samples";
import { cn, formatNum } from "@/lib/utils";
import {
  UploadCloud, FileSearch, ShieldCheck, Zap, Sparkles, ChevronRight, Layers,
  ImageIcon, Video, Music, FileText, Table, Presentation, BookOpen, Archive,
  Code2, Type, Braces, Database, Mail, Map, FlaskConical, Gamepad2, Cpu, HardDrive,
  Settings2, Captions, Binary, Globe, MousePointerClick, FolderDown,
} from "lucide-react";

export function Landing({
  onFiles,
  onExplore,
  totalIdentities,
  recent,
}: {
  onFiles: (files: File[]) => void;
  onExplore: (cat?: string) => void;
  totalIdentities: number;
  recent?: React.ReactNode;
}) {
  const [samples, setSamples] = React.useState<SampleFile[] | null>(null);
  const [count, setCount] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    makeSamples().then(setSamples).catch(() => setSamples([]));
  }, []);

  // count-up animation
  React.useEffect(() => {
    const start = performance.now();
    const dur = 1600;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(totalIdentities * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [totalIdentities]);

  const CAT_ICONS: Record<string, React.ReactNode> = {
    image: <ImageIcon className="h-5 w-5" />, video: <Video className="h-5 w-5" />,
    audio: <Music className="h-5 w-5" />, document: <FileText className="h-5 w-5" />,
    spreadsheet: <Table className="h-5 w-5" />, presentation: <Presentation className="h-5 w-5" />,
    ebook: <BookOpen className="h-5 w-5" />, archive: <Archive className="h-5 w-5" />,
    code: <Code2 className="h-5 w-5" />, text: <Type className="h-5 w-5" />,
    data: <Braces className="h-5 w-5" />, font: <Type className="h-5 w-5" />,
    "3d": <Layers className="h-5 w-5" />, database: <Database className="h-5 w-5" />,
    email: <Mail className="h-5 w-5" />, geo: <Map className="h-5 w-5" />,
    scientific: <FlaskConical className="h-5 w-5" />, game: <Gamepad2 className="h-5 w-5" />,
    system: <Cpu className="h-5 w-5" />, disk: <HardDrive className="h-5 w-5" />,
    config: <Settings2 className="h-5 w-5" />, subtitle: <Captions className="h-5 w-5" />,
    binary: <Binary className="h-5 w-5" />, other: <Globe className="h-5 w-5" />,
  };

  const CAT_HUES: Record<string, string> = {
    image: "text-emerald-400 bg-emerald-950/50 border-emerald-900/40",
    video: "text-rose-400 bg-rose-950/40 border-rose-900/40",
    audio: "text-amber-400 bg-amber-950/40 border-amber-900/40",
    document: "text-teal-400 bg-teal-950/40 border-teal-900/40",
    spreadsheet: "text-lime-400 bg-lime-950/40 border-lime-900/40",
    presentation: "text-orange-400 bg-orange-950/40 border-orange-900/40",
    ebook: "text-violet-400 bg-violet-950/40 border-violet-900/40",
    archive: "text-yellow-300 bg-yellow-950/30 border-yellow-900/40",
    code: "text-emerald-300 bg-zinc-900 border-zinc-700",
    text: "text-zinc-300 bg-zinc-900 border-zinc-700",
    data: "text-fuchsia-400 bg-fuchsia-950/40 border-fuchsia-900/40",
    font: "text-pink-400 bg-pink-950/40 border-pink-900/40",
    "3d": "text-teal-300 bg-teal-950/40 border-teal-900/40",
    database: "text-cyan-300 bg-cyan-950/30 border-cyan-900/40",
    email: "text-orange-300 bg-orange-950/30 border-orange-900/40",
    geo: "text-green-400 bg-green-950/40 border-green-900/40",
    scientific: "text-purple-300 bg-purple-950/40 border-purple-900/40",
    game: "text-fuchsia-300 bg-fuchsia-950/30 border-fuchsia-900/40",
    system: "text-zinc-200 bg-zinc-900 border-zinc-700",
    disk: "text-stone-300 bg-stone-900/50 border-stone-700/60",
    config: "text-amber-200 bg-amber-950/30 border-amber-900/40",
    subtitle: "text-sky-200 bg-zinc-900 border-zinc-700",
    binary: "text-zinc-400 bg-zinc-900 border-zinc-800",
    other: "text-zinc-300 bg-zinc-900 border-zinc-800",
  };

  const stats = [
    { label: "format identities", value: count, icon: <Sparkles className="h-4 w-4 text-emerald-400" /> },
    { label: "extensions", value: FORMAT_STATS.extensions, icon: <FileSearch className="h-4 w-4 text-amber-400" /> },
    { label: "magic signatures", value: FORMAT_STATS.signatures, icon: <Zap className="h-4 w-4 text-rose-400" /> },
    { label: "categories", value: FORMAT_STATS.categories, icon: <Layers className="h-4 w-4 text-teal-400" /> },
  ];

  return (
    <div className="relative flex-1 overflow-y-auto scrollbar-thin">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[120px]" />
        <div className="absolute right-[-200px] top-60 h-[360px] w-[520px] rounded-full bg-amber-500/[0.07] blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
            backgroundSize: "34px 34px",
          }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 pb-10 pt-10 sm:px-6 lg:pt-16">
        {/* header */}
        <header className="mb-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <div>
              <div className="text-lg font-bold tracking-tight text-zinc-100">OMNISCOPE</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">universal file lab</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-900/60 bg-emerald-950/40 px-3 py-1 text-[11px] font-medium text-emerald-300 sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" /> 100% client-side
            </span>
            <button
              type="button"
              onClick={() => onExplore()}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-emerald-700 hover:text-emerald-300"
            >
              <FileSearch className="h-3.5 w-3.5" />
              Explore formats
            </button>
          </div>
        </header>

        {/* hero */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 text-center"
        >
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight text-zinc-100 sm:text-6xl">
            Open <span className="text-shimmer bg-gradient-to-r from-emerald-300 via-teal-200 to-emerald-200 bg-clip-text text-transparent">anything</span>.
            <br />
            Understand every byte.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            A forensic-grade universal file viewer that runs entirely in your browser.
            {" "}<span className="font-mono text-emerald-300">{formatNum(count)}</span> recognized format identities —
            from PNG to NBT, from CP437 NFOs to DICOM scans. No uploads. No servers. No limits.
          </p>
        </motion.section>

        {/* drop zone */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-6"
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group relative block w-full overflow-hidden rounded-2xl border-2 border-dashed border-zinc-600 bg-zinc-900/40 px-6 py-14 text-center transition-all duration-300 hover:border-emerald-600 hover:bg-emerald-950/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            aria-label="Choose files to open"
          >
            <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{
              background: "radial-gradient(ellipse at center, color-mix(in srgb, var(--color-emerald-500, #10b981) 8%, transparent), transparent 70%)",
            }} />
            <UploadCloud className="mx-auto mb-4 h-12 w-12 text-zinc-600 transition-all duration-300 group-hover:-translate-y-1 group-hover:text-emerald-400" />
            <div className="text-base font-semibold text-zinc-200">Drop files or whole folders anywhere, paste, or click to browse</div>
            <div className="mt-1.5 text-xs text-zinc-500">
              anything from a <span className="font-mono text-zinc-400">.txt</span> to an obscure <span className="font-mono text-zinc-400">.blend</span> — detected by magic bytes, not just extensions
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-[10px] text-zinc-600">
              <span className="inline-flex items-center gap-1.5">
                <kbd>Ctrl</kbd>
                +
                <kbd>O</kbd>
                open
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd>Ctrl</kbd>
                +
                <kbd>V</kbd>
                paste a file
              </span>
              <span className="inline-flex items-center gap-1.5">
                <FolderDown className="h-3 w-3" />
                drop a folder — its files open recursively
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd>?</kbd>
                shortcuts
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) onFiles(files);
                e.target.value = "";
              }}
            />
          </button>
        </motion.section>

        {/* recents (client-side IndexedDB) */}
        {recent ? <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="mb-6"
        >{recent}</motion.section> : null}

        {/* samples */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mb-10"
        >
          <div className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            <MousePointerClick className="h-3.5 w-3.5" /> try a generated sample
          </div>
          <div className="flex flex-wrap gap-2">
            {samples === null ? (
              Array.from({ length: 8 }, (_, i) => <div key={i} className="h-7 w-24 animate-pulse rounded-full bg-zinc-800/60" />)
            ) : (
              samples.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => onFiles([new File([s.blob], s.name, { type: s.blob.type })])}
                  className="group pressable inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 py-1 pl-3 pr-3.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-emerald-700 hover:bg-emerald-950/30 hover:text-emerald-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 transition-colors group-hover:bg-emerald-400" />
                  {s.name.replace("sample.", "")}
                  <span className="text-zinc-600 group-hover:text-emerald-500/70">{s.label}</span>
                </button>
              ))
            )}
          </div>
        </motion.section>

        {/* stats */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="group rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-900/30 p-4 transition-colors duration-200 hover:border-zinc-700 focus-within:border-emerald-800"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                {s.icon} {s.label}
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-zinc-100 transition-colors duration-200 group-hover:text-emerald-200">{formatNum(s.value)}</div>
            </div>
          ))}
        </motion.section>

        {/* category grid */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mb-10"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Format families</h2>
            <button type="button" onClick={() => onExplore()} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300">
              full registry <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {FORMAT_STATS.byCat.map(([cat, n]) => (
              <button
                key={cat}
                type="button"
                onClick={() => onExplore(cat)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border p-3 text-left transition-[transform,border-color] duration-150 hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 active:scale-[0.98]",
                  CAT_HUES[cat] ?? CAT_HUES.other,
                )}
              >
                <span className="shrink-0 rounded-lg border border-inherit p-1.5 transition-transform duration-150 group-hover:-translate-y-0.5">{CAT_ICONS[cat] ?? CAT_ICONS.other}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-zinc-200">{CATEGORY_LABELS[cat] ?? cat}</span>
                  <span className="mt-0.5 block font-mono text-[10px] tabular-nums"><span className="text-zinc-400">{formatNum(n)}</span> <span className="text-zinc-500">formats</span></span>
                </span>
              </button>
            ))}
          </div>
        </motion.section>

        {/* how it works */}
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="grid gap-3 sm:grid-cols-3"
        >
          {[
            {
              icon: <Zap className="h-5 w-5 text-amber-400" />,
              title: "Magic-byte detection",
              text: "Files are identified by their binary signatures — renamed or extensionless files still route to the right viewer. OOXML and ODF containers are sniffed deep.",
            },
            {
              icon: <ShieldCheck className="h-5 w-5 text-emerald-400" />,
              title: "Zero upload",
              text: "Bytes never leave the page. Parsing, decoding, hashing and rendering all happen with Web APIs in your tab — GitHub-Pages deployable.",
            },
            {
              icon: <FileSearch className="h-5 w-5 text-teal-300" />,
              title: "Customized per format",
              text: "Waveforms for audio, piano rolls for MIDI, boards for chess, plots for GPS, entropy maps for binaries — plus per-format exports (XLSX, JSON, HTML, SRT↔VTT) and printable forensic reports.",
            },
          ].map((f) => (
            <div key={f.title} className="flex h-full flex-col rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/70 to-zinc-900/30 p-4 transition-colors duration-200 hover:border-zinc-700">
              <div className="mb-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">{f.icon}</div>
              <div className="text-sm font-semibold text-zinc-200">{f.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{f.text}</p>
            </div>
          ))}
        </motion.section>
      </div>
    </div>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-9 w-9 items-center justify-center", className)} aria-hidden>
      <svg viewBox="0 0 36 36" className="h-full w-full">
        <defs>
          <linearGradient id="omni-g" x1="0" y1="0" x2="36" y2="36">
            <stop offset="0" style={{ stopColor: "var(--color-emerald-400, #34d399)" }} />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
        <rect x="5" y="2" width="26" height="32" rx="4" fill="none" stroke="url(#omni-g)" strokeWidth="2.4" />
        <rect x="11" y="8" width="8" height="2.4" rx="1.2" fill="url(#omni-g)" />
        <rect x="11" y="13.5" width="14" height="2.4" rx="1.2" fill="url(#omni-g)" opacity="0.85" />
        <rect x="11" y="19" width="11" height="2.4" rx="1.2" fill="url(#omni-g)" opacity="0.7" />
        <circle cx="24.5" cy="25" r="4.5" fill="none" stroke="url(#omni-g)" strokeWidth="2.4" />
        <circle cx="24.5" cy="25" r="1.6" style={{ fill: "var(--color-emerald-400, #34d399)" }} />
      </svg>
    </span>
  );
}
