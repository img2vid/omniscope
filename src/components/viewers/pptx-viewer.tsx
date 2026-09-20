"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip, Segmented,
  SectionCard, InfoGrid, Field, Copyable, EmptyHint,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes, formatNum, latin1, utf16LE } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, Presentation, Download, StickyNote, Binary, FileText,
} from "lucide-react";

const BULLET_CAP = 60;

interface PptSlide {
  n: number;
  title: string;
  lines: string[]; // remaining paragraphs (bullets)
  notes: string;
}

function isCfb(head: Uint8Array): boolean {
  return head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0
    && head[4] === 0xa1 && head[5] === 0xe1 && head[6] === 0xb1 && head[7] === 0x1a;
}

/** local-name helpers (namespace-prefix agnostic) */
function byLocal(el: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const all = el.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

function paraText(p: Element): string {
  let s = "";
  for (const t of byLocal(p, "t")) s += t.textContent ?? "";
  return s.trim();
}

/** walk shapes (sp / graphicFrame) in document order, collecting paragraph text */
function extractSlideTexts(doc: Document): { shapeParas: string[][]; otherParas: string[] } {
  const shapeIds = new Map<Element, number>();
  let nextId = 0;
  const shapeParas: string[][] = [];
  const otherParas: string[] = [];
  const paragraphs = byLocal(doc, "p").filter((p) => {
    // only drawing paragraphs: they live under a txBody
    let cur: Node | null = p.parentNode;
    while (cur && cur.nodeType === 1) {
      const ln = (cur as Element).localName;
      if (ln === "txBody") return true;
      if (ln === "sp" || ln === "graphicFrame" || ln === "bodyPr") return false;
      cur = cur.parentNode;
    }
    return false;
  });
  for (const p of paragraphs) {
    const text = paraText(p);
    if (!text) continue;
    // find nearest shape ancestor
    let cur: Node | null = p.parentNode;
    let shape: Element | null = null;
    while (cur && cur.nodeType === 1) {
      const ln = (cur as Element).localName;
      if (ln === "sp" || ln === "graphicFrame") { shape = cur as Element; break; }
      cur = cur.parentNode;
    }
    if (shape) {
      let id = shapeIds.get(shape);
      if (id === undefined) { id = nextId++; shapeIds.set(shape, id); shapeParas[id] = []; }
      shapeParas[id].push(text);
    } else {
      otherParas.push(text);
    }
  }
  return { shapeParas: shapeParas.filter(Boolean), otherParas };
}

function parseSlides(zip: Record<string, Uint8Array>): PptSlide[] {
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const notesRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
  const slideKeys: { n: number; key: string }[] = [];
  const notesMap = new Map<number, string>();
  for (const key of Object.keys(zip)) {
    const sm = slideRe.exec(key);
    if (sm) { slideKeys.push({ n: parseInt(sm[1], 10), key }); continue; }
    const nm = notesRe.exec(key);
    if (nm) {
      try {
        const doc = new DOMParser().parseFromString(strFrom(zip[key]), "application/xml");
        const { shapeParas, otherParas } = extractSlideTexts(doc);
        const lines = [...shapeParas.flat(), ...otherParas].filter((t) => !/^\d+$/.test(t));
        notesMap.set(parseInt(nm[1], 10), lines.join("\n"));
      } catch { /* unparseable notes */ }
    }
  }
  slideKeys.sort((a, b) => a.n - b.n);
  const parser = new DOMParser();
  return slideKeys.map(({ n, key }) => {
    let title = "";
    let lines: string[] = [];
    try {
      const doc = parser.parseFromString(strFrom(zip[key]), "application/xml");
      const { shapeParas, otherParas } = extractSlideTexts(doc);
      const all = [...shapeParas.flat(), ...otherParas];
      if (all.length) {
        const first = all[0];
        if (first.length <= 140) {
          title = first;
          lines = all.slice(1);
        } else {
          lines = all;
        }
      }
    } catch { /* unparseable slide */ }
    return { n, title, lines, notes: notesMap.get(n) ?? "" };
  });
}

function strFrom(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return latin1(bytes);
  }
}

/* ------------------------------ legacy .ppt recovery ------------------------------ */

function recoverLegacyText(bytes: Uint8Array): string {
  const cap = Math.min(bytes.length, 16 * 1024 * 1024);
  const b = bytes.subarray(0, cap);
  const harvest = (decoded: string): { lines: string[]; letters: number } => {
    const lines: string[] = [];
    let letters = 0;
    const re = /[!-~\t ]{4,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(decoded))) {
      const run = m[0].trim();
      const lc = (run.match(/[A-Za-z]/g) || []).length;
      if (run.length >= 4 && lc >= 2) {
        lines.push(run.slice(0, 4000));
        letters += lc;
        if (lines.length > 6000) break;
      }
    }
    return { lines, letters };
  };
  const l1 = harvest(latin1(b));
  const u16 = harvest(utf16LE(b));
  const lines = u16.letters > l1.letters * 1.5 ? u16.lines : l1.lines;
  const text = lines.join("\n");
  return text.length > 400_000 ? text.slice(0, 400_000) + "\n\n[truncated]" : text;
}

interface Parsed {
  slides: PptSlide[];
  kind: "pptx" | "ppt";
  legacyText?: string;
}

export default function PptxViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [parsed, setParsed] = React.useState<Parsed | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [idx, setIdx] = React.useState(0);
  const [mode, setMode] = React.useState<"slide" | "overview">("slide");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setParsed(null);
      setError(null);
      setIdx(0);
      setMode("slide");
      try {
        if (isCfb(head)) {
          if (!arrayBuffer) {
            setError({
              message: "This legacy .ppt file exceeds the in-memory load cap (96 MB).",
              hint: "Use the hex view, or convert the presentation to .pptx for full rendering.",
            });
            return;
          }
          const text = recoverLegacyText(new Uint8Array(arrayBuffer));
          if (cancelled) return;
          setParsed({ slides: [], kind: "ppt", legacyText: text });
          return;
        }
        if (!arrayBuffer) {
          setError({
            message: "This .pptx file exceeds the in-memory load cap (96 MB).",
            hint: "Extract the file from an archive first, or inspect it with the hex viewer.",
          });
          return;
        }
        const { unzipSync, strFromU8 } = await import("fflate");
        const zip = unzipSync(new Uint8Array(arrayBuffer));
        if (cancelled) return;
        // sanity: is this really a pptx package?
        const hasSlides = Object.keys(zip).some((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
        const hasContent = Object.keys(zip).some((k) => k === "[Content_Types].xml" || k.startsWith("ppt/"));
        if (!hasSlides && hasContent) {
          setError({
            message: "No slides found in this OOXML package.",
            hint: "The archive looks like an Office package but contains no ppt/slides/slideN.xml entries.",
          });
          return;
        }
        if (!hasContent) {
          setError({
            message: "This zip archive does not look like a .pptx package.",
            hint: "Try the archive viewer to inspect its contents.",
          });
          return;
        }
        const slides = parseSlides(zip);
        if (cancelled) return;
        setParsed({ slides, kind: "pptx" });
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "The package could not be decompressed or parsed. It may be corrupted or password-protected.",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [arrayBuffer, head]);

  if (error) return <ErrorCard title="Cannot open this presentation" message={error.message} hint={error.hint} />;

  if (!parsed) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">Slides</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Unpacking presentation…" />
      </div>
    );
  }

  /* ------------------------------ legacy .ppt ------------------------------ */
  if (parsed.kind === "ppt") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar
          left={<><Chip tone="amber">Legacy .ppt</Chip><Chip tone="teal">text recovered</Chip></>}
          right={
            <ToolButton label="Save .txt" onClick={() => downloadBlob(parsed.legacyText ?? "", fileName.replace(/\.\w+$/, "") + "-recovered.txt", "text/plain")}>
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          }
        />
        <ViewerBody className="p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            <SectionCard title="Legacy binary PowerPoint document" icon={<Binary className="h-3.5 w-3.5" />}>
              <div className="mb-3 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                Legacy .ppt — text recovered. This is an OLE/CFB binary container; slide layouts and images cannot
                be reconstructed client-side. Convert to .pptx for a faithful view.
              </div>
              <InfoGrid>
                <Field label="Magic" mono>D0 CF 11 E0 A1 E1 B1 1A (CFB)</Field>
                <Field label="Size">{formatBytes(file.size)}</Field>
                <Field label="Format">{detected.name}</Field>
                <Field label="File"><Copyable value={fileName} /></Field>
              </InfoGrid>
            </SectionCard>
            <SectionCard title="Recovered text" icon={<FileText className="h-3.5 w-3.5" />}>
              {parsed.legacyText ? (
                <pre className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-5 text-zinc-300 scrollbar-thin">{parsed.legacyText}</pre>
              ) : (
                <EmptyHint>No printable text runs found — the deck may be empty or DRMed.</EmptyHint>
              )}
            </SectionCard>
          </div>
        </ViewerBody>
      </div>
    );
  }

  /* ------------------------------ .pptx ------------------------------ */
  const slides = parsed.slides;
  if (!slides.length) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">PowerPoint</Chip>} />
        <EmptyHint>This presentation contains no slides with extractable content.</EmptyHint>
      </div>
    );
  }

  const current = slides[Math.min(idx, slides.length - 1)];
  const notesCount = slides.filter((s) => s.notes).length;

  const exportText = () => {
    const text = slides.map((s) => {
      const head = s.title ? s.title : "(untitled slide)";
      const body = s.lines.map((l) => `  • ${l}`).join("\n");
      const notes = s.notes ? `\nNotes:\n  ${s.notes.split("\n").join("\n  ")}` : "";
      return `— Slide ${s.n} —\n${head}\n${body}${notes}`;
    }).join("\n\n");
    downloadBlob(text, fileName.replace(/\.\w+$/, "") + "-slides.txt", "text/plain");
  };

  const go = (n: number) => setIdx(Math.max(0, Math.min(slides.length - 1, n)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.ext === "pptx" ? "PPTX" : "Slides"}</Chip>
            <ToolbarDivider />
            <ToolButton label="Prev" disabled={idx <= 0 || mode === "overview"} onClick={() => go(idx - 1)}><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
            <span className="min-w-16 text-center font-mono text-[11px] text-zinc-300">
              {idx + 1} <span className="text-zinc-600">/ {slides.length}</span>
            </span>
            <ToolButton label="Next" disabled={idx >= slides.length - 1 || mode === "overview"} onClick={() => go(idx + 1)}><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
        center={
          <Segmented
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: "slide", label: "Slide" },
              { value: "overview", label: "Overview" },
            ]}
          />
        }
        right={
          <>
            <ToolButton label="Save text" onClick={exportText} title="Export all slide text"><Download className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />

      {mode === "slide" ? (
        <div className="flex min-h-0 flex-1">
          {/* slide overview rail */}
          <nav className="hidden w-48 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950/60 p-2 scrollbar-thin lg:block" aria-label="Slide overview">
            {slides.map((s, i) => (
              <button
                key={s.n}
                type="button"
                onClick={() => setIdx(i)}
                className={cn(
                  "mb-1 flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition-colors",
                  i === idx ? "border-emerald-800/60 bg-emerald-900/30 text-emerald-200" : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                )}
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-600">{s.n}</span>
                <span className="min-w-0 flex-1 truncate">{s.title || s.lines[0] || "(empty)"}</span>
              </button>
            ))}
          </nav>

          <ViewerBody className="p-4">
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="relative aspect-video overflow-hidden rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 shadow-xl shadow-black/40">
                <div className="flex h-full flex-col overflow-hidden p-6 sm:p-10">
                  {current.title ? (
                    <h2 className="mb-4 shrink-0 border-b border-zinc-700/70 pb-3 text-xl font-semibold text-zinc-50 sm:text-2xl">{current.title}</h2>
                  ) : null}
                  <ul className="min-h-0 flex-1 space-y-2 overflow-hidden text-sm leading-relaxed text-zinc-300 sm:text-[15px]">
                    {current.lines.slice(0, BULLET_CAP).map((line, i) => (
                      <li key={i} className="flex gap-2 overflow-hidden">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80" />
                        <span className="min-w-0 break-words">{line}</span>
                      </li>
                    ))}
                    {current.lines.length > BULLET_CAP ? <li className="text-[11px] text-zinc-500">… {current.lines.length - BULLET_CAP} more lines</li> : null}
                    {!current.title && !current.lines.length ? <li className="text-zinc-500">(no text on this slide)</li> : null}
                  </ul>
                </div>
                <span className="absolute bottom-2 right-3 rounded bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                  {current.n} / {slides.length}
                </span>
              </div>

              {current.notes ? (
                <SectionCard
                  title="Speaker notes"
                  icon={<StickyNote className="h-3.5 w-3.5" />}
                  right={<Chip tone="amber">recovered</Chip>}
                >
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-zinc-400 scrollbar-thin">{current.notes}</pre>
                </SectionCard>
              ) : null}
            </div>
          </ViewerBody>
        </div>
      ) : (
        <ViewerBody className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {slides.map((s, i) => (
              <button
                key={s.n}
                type="button"
                onClick={() => { setIdx(i); setMode("slide"); }}
                className="group relative aspect-video overflow-hidden rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-800/50 p-3 text-left transition-colors hover:border-emerald-700/70"
              >
                <div className="flex h-full flex-col overflow-hidden">
                  {s.title ? <div className="mb-2 truncate text-xs font-semibold text-zinc-200">{s.title}</div> : null}
                  <ul className="min-h-0 flex-1 space-y-1 overflow-hidden text-[10.5px] leading-4 text-zinc-500">
                    {s.lines.slice(0, 7).map((line, j) => (
                      <li key={j} className="flex gap-1.5 truncate">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-500/60" />
                        <span className="truncate">{line}</span>
                      </li>
                    ))}
                    {s.lines.length > 7 ? <li className="text-zinc-600">… {s.lines.length - 7} more</li> : null}
                    {!s.title && !s.lines.length ? <li className="text-zinc-600">(no text)</li> : null}
                  </ul>
                </div>
                <span className="absolute bottom-1 right-1.5 font-mono text-[9px] text-zinc-600 group-hover:text-emerald-500">{s.n}</span>
                {s.notes ? <StickyNote className="absolute right-1.5 top-1.5 h-3 w-3 text-amber-500/60" /> : null}
              </button>
            ))}
          </div>
        </ViewerBody>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Presentation className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{fileName}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          {slides.length} slide{slides.length === 1 ? "" : "s"} · {notesCount} with notes · {formatBytes(file.size)} · {formatNum(file.size)} B
        </span>
      </div>
    </div>
  );
}
