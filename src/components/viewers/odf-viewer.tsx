"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Chip, Segmented,
  EmptyHint,
} from "./viewer-ui";
import { cn, downloadBlob, formatBytes, formatNum } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight, Download, Layers, Image as ImageIcon, Presentation, Type as TypeIcon,
} from "lucide-react";

const BLOCK_CAP = 4000;
const IMG_BYTE_CAP = 96 * 1024 * 1024;

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string; titleish?: boolean }
  | { kind: "list"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; href: string };

interface Page { name: string; blocks: Block[] }
interface OdfParsed {
  mode: "text" | "pages" | "spreadsheet";
  kind: string;
  blocks: Block[];
  pages: Page[];
  counts: { paragraphs: number; images: number };
  imageHrefs: string[];
  mime: string;
}

/* ------------------------------ xml helpers ------------------------------ */

function byLocal(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

/** text content honouring text:s / text:tab / text:line-break */
function odfText(el: Element): string {
  let s = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) { s += node.nodeValue ?? ""; return; }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    const ln = e.localName;
    if (ln === "s") { s += " ".repeat(Math.max(1, parseInt(e.getAttribute("text:c") ?? "1", 10) || 1)); return; }
    if (ln === "tab") { s += "\t"; return; }
    if (ln === "line-break") { s += "\n"; return; }
    if (ln === "note" || ln === "annotation" || ln === "bookmark" || ln === "bookmark-start" || ln === "bookmark-end") return;
    for (let i = 0; i < e.childNodes.length; i++) walk(e.childNodes[i]);
  };
  for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]);
  return s;
}

function attrNS(el: Element, qualified: string, ns: string, local: string): string {
  const v = el.getAttributeNS(ns, local) ?? el.getAttribute(qualified);
  return v ?? "";
}

const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const XLINK_NS = "http://www.w3.org/1999/xlink";

function frameBlocks(frame: Element, blocks: Block[], counts: { paragraphs: number; images: number }, hrefs: string[]) {
  // image?
  const img = byLocal(frame, "image")[0];
  if (img) {
    const href = attrNS(img, "xlink:href", XLINK_NS, "href");
    if (href) {
      blocks.push({ kind: "image", href });
      hrefs.push(href);
      counts.images++;
    }
  }
  // text inside the frame (draw:text-box > text:h / text:p)
  const cls = frame.getAttribute("presentation:class") ?? "";
  const titleish = cls === "title" || cls === "subtitle";
  for (const p of [...byLocal(frame, "h"), ...byLocal(frame, "p")]) {
    const text = odfText(p).trim();
    if (!text) continue;
    counts.paragraphs++;
    if (p.localName === "h" || titleish) {
      blocks.push({ kind: "h", level: p.localName === "h" ? (parseInt(attrNS(p, "text:outline-level", TEXT_NS, "outline-level") || "1", 10) || 1) : 1, text });
    } else {
      blocks.push({ kind: "p", text });
    }
  }
}

function parseContainer(el: Element, blocks: Block[], counts: { paragraphs: number; images: number }, hrefs: string[], depth: number) {
  if (blocks.length > BLOCK_CAP || depth > 12) return;
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i];
    if (node.nodeType !== 1) continue;
    const e = node as Element;
    const ln = e.localName;
    if (ln === "h") {
      const text = odfText(e).trim();
      if (text) {
        counts.paragraphs++;
        const level = parseInt(attrNS(e, "text:outline-level", TEXT_NS, "outline-level") || "1", 10) || 1;
        blocks.push({ kind: "h", level: Math.min(6, Math.max(1, level)), text });
      }
    } else if (ln === "p") {
      const text = odfText(e).trim();
      if (text) {
        counts.paragraphs++;
        blocks.push({ kind: "p", text });
      }
    } else if (ln === "list") {
      const items: string[] = [];
      for (const li of byLocal(e, "list-item")) {
        const ps = byLocal(li, "p");
        const text = ps.map((p) => odfText(p).trim()).filter(Boolean).join(" ");
        if (text) items.push(text);
      }
      if (items.length) blocks.push({ kind: "list", items });
    } else if (ln === "table") {
      const rows: string[][] = [];
      for (const tr of byLocal(e, "table-row")) {
        const cells = byLocal(tr, "table-cell").map((tc) => odfText(tc).trim());
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length) blocks.push({ kind: "table", rows });
    } else if (ln === "frame" || ln === "g") {
      if (ln === "frame") frameBlocks(e, blocks, counts, hrefs);
      else parseContainer(e, blocks, counts, hrefs, depth + 1);
    } else if (ln === "section" || ln === "text-box" || ln === "deletion" || ln === "insertion") {
      parseContainer(e, blocks, counts, hrefs, depth + 1);
    }
    // everything else (tracked-changes, forms, …) is skipped
  }
}

function parseOdf(contentXml: string, mime: string): OdfParsed {
  const doc = new DOMParser().parseFromString(contentXml, "application/xml");
  if (byLocal(doc, "parsererror").length) throw new Error("content.xml is not well-formed XML");
  if (byLocal(doc, "spreadsheet").length) {
    return { mode: "spreadsheet", kind: kindLabel(mime), blocks: [], pages: [], counts: { paragraphs: 0, images: 0 }, imageHrefs: [], mime };
  }
  const counts = { paragraphs: 0, images: 0 };
  const hrefs: string[] = [];
  const pageEls = byLocal(doc, "page").filter((p) => (p.namespaceURI ?? "").includes("opendocument"));
  if (pageEls.length) {
    // presentation / drawing
    const pages: Page[] = pageEls.map((pg, i) => {
      const blocks: Block[] = [];
      for (const frame of byLocal(pg, "frame")) frameBlocks(frame, blocks, counts, hrefs);
      return { name: pg.getAttribute("draw:name") || `Page ${i + 1}`, blocks };
    });
    return { mode: "pages", kind: kindLabel(mime), blocks: [], pages, counts, imageHrefs: hrefs, mime };
  }
  const textEl = byLocal(doc, "text")[0];
  const blocks: Block[] = [];
  if (textEl) parseContainer(textEl, blocks, counts, hrefs, 0);
  return { mode: "text", kind: kindLabel(mime), blocks, pages: [], counts, imageHrefs: hrefs, mime };
}

function kindLabel(mime: string): string {
  if (mime.includes("presentation")) return "ODP";
  if (mime.includes("graphics") || mime.includes("drawing")) return "ODG";
  if (mime.includes("text")) return "ODT";
  return "ODF";
}

function resolveZipHref(zip: Record<string, Uint8Array>, href: string): string | null {
  const h = href.replace(/^\.\//, "").replace(/^\//, "").split("?")[0];
  if (zip[h]) return h;
  // try matching by basename (some producers mangle prefixes)
  const base = h.split("/").pop() ?? h;
  for (const k of Object.keys(zip)) {
    if (k.split("/").pop() === base) return k;
  }
  return null;
}

export default function OdfViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [parsed, setParsed] = React.useState<OdfParsed | null>(null);
  const [error, setError] = React.useState<{ message: string; hint?: string } | null>(null);
  const [imgMap, setImgMap] = React.useState<Record<string, string>>({});
  const [pageMode, setPageMode] = React.useState<"page" | "all">("page");
  const [pageIdx, setPageIdx] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      setParsed(null);
      setError(null);
      setImgMap({});
      setPageIdx(0);
      setPageMode("page");
      try {
        if (!arrayBuffer) {
          setError({
            message: "This OpenDocument file exceeds the in-memory load cap (96 MB).",
            hint: "Use the hex view or extract the inner streams first.",
          });
          return;
        }
        const { unzipSync, strFromU8 } = await import("fflate");
        const zip = unzipSync(new Uint8Array(arrayBuffer));
        if (cancelled) return;
        const contentKey = Object.keys(zip).find((k) => k === "content.xml" || k.endsWith("/content.xml"));
        if (!contentKey) throw new Error("no content.xml found — is this a valid OpenDocument package?");
        const mime = zip["mimetype"] ? strFromU8(zip["mimetype"]).trim() : detected.mime || "";
        const parsedDoc = parseOdf(strFromU8(zip[contentKey]), mime);
        if (cancelled) return;
        // build blob URLs for referenced images
        const map: Record<string, string> = {};
        let used = 0;
        for (const href of parsedDoc.imageHrefs) {
          const key = resolveZipHref(zip, href);
          if (!key) continue;
          const data = zip[key];
          if (used + data.length > IMG_BYTE_CAP) break;
          used += data.length;
          const type = key.endsWith(".png") ? "image/png" : key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg"
            : key.endsWith(".gif") ? "image/gif" : key.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
          if (type === "application/octet-stream" && !/\.(png|jpe?g|gif|svg)$/i.test(key)) continue;
          const url = URL.createObjectURL(new Blob([data as unknown as BlobPart], { type }));
          urls.push(url);
          map[href] = url;
        }
        if (cancelled) {
          urls.forEach((u) => URL.revokeObjectURL(u));
          return;
        }
        setImgMap(map);
        setParsed(parsedDoc);
      } catch (e: any) {
        if (cancelled) return;
        setError({
          message: String(e?.message ?? e),
          hint: "If this file uses exotic ODF features, try converting it to flat XML (.fodt/.fodp) or inspect it with the hex viewer.",
        });
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [arrayBuffer, detected.mime]);

  if (error) return <ErrorCard title="Cannot open this OpenDocument file" message={error.message} hint={error.hint} />;

  if (!parsed) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<Chip tone="emerald">ODF</Chip>} right={<span className="px-2 font-mono text-[10px] text-zinc-600">{fileName}</span>} />
        <LoadingState label="Unpacking OpenDocument…" />
      </div>
    );
  }

  if (parsed.mode === "spreadsheet") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ViewerToolbar left={<><Chip tone="emerald">ODS</Chip><Chip tone="amber">spreadsheet</Chip></>} />
        <EmptyHint>
          This is an OpenDocument Spreadsheet (.ods). It is routed to the Sheet viewer — switch the tab
          viewer to “Sheet” for full rendering (this ODF viewer handles Writer/Impress/Draw documents).
        </EmptyHint>
      </div>
    );
  }

  const total = parsed.mode === "pages" ? parsed.pages.length : 1;
  const exportText = () => {
    const collect = (blocks: Block[]): string =>
      blocks.map((b) => {
        if (b.kind === "h") return b.text + "\n";
        if (b.kind === "p") return b.text + "\n";
        if (b.kind === "list") return b.items.map((i) => `  • ${i}`).join("\n") + "\n";
        if (b.kind === "table") return b.rows.map((r) => r.join("\t")).join("\n") + "\n";
        return "[image]\n";
      }).join("");
    const text = parsed.mode === "pages"
      ? parsed.pages.map((p, i) => `— ${p.name || `Page ${i + 1}`} —\n${collect(p.blocks)}`).join("\n")
      : collect(parsed.blocks);
    downloadBlob(text, fileName.replace(/\.\w+$/, "") + ".txt", "text/plain");
  };

  const current = parsed.mode === "pages" ? parsed.pages[Math.min(pageIdx, total - 1)] : null;
  const noContent = parsed.mode === "pages" ? !parsed.pages.some((p) => p.blocks.length) : !parsed.blocks.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{parsed.kind}</Chip>
            {parsed.mode === "pages" ? (
              <>
                <ToolbarDivider />
                <ToolButton label="Prev" disabled={pageIdx <= 0 || pageMode === "all"} onClick={() => setPageIdx((i) => Math.max(0, i - 1))}><ChevronLeft className="h-3.5 w-3.5" /></ToolButton>
                <span className="min-w-14 text-center font-mono text-[11px] text-zinc-300">{pageMode === "page" ? `${pageIdx + 1} / ${total}` : `${total} pages`}</span>
                <ToolButton label="Next" disabled={pageIdx >= total - 1 || pageMode === "all"} onClick={() => setPageIdx((i) => Math.min(total - 1, i + 1))}><ChevronRight className="h-3.5 w-3.5" /></ToolButton>
              </>
            ) : null}
            <Chip><span className="inline-flex items-center gap-1"><TypeIcon className="h-3 w-3" />{formatNum(parsed.counts.paragraphs)} ¶</span></Chip>
            {parsed.counts.images ? <Chip tone="teal"><span className="inline-flex items-center gap-1"><ImageIcon className="h-3 w-3" />{parsed.counts.images}</span></Chip> : null}
          </>
        }
        center={
          parsed.mode === "pages" ? (
            <Segmented
              value={pageMode}
              onChange={(v) => setPageMode(v)}
              options={[{ value: "page", label: "Page" }, { value: "all", label: "All pages" }]}
            />
          ) : undefined
        }
        right={
          <ToolButton label="Export text" onClick={exportText} title="Export document text"><Download className="h-3.5 w-3.5" /></ToolButton>
        }
      />

      {noContent ? (
        <EmptyHint>No text content found in this {parsed.kind} document — it may be empty or image-only.</EmptyHint>
      ) : parsed.mode === "text" ? (
        <ViewerBody className="flex justify-center">
          <div className="odf-body w-full max-w-3xl px-6 py-8">
            <Blocks blocks={parsed.blocks} imgMap={imgMap} />
          </div>
        </ViewerBody>
      ) : pageMode === "page" && current ? (
        <ViewerBody className="flex justify-center p-4">
          <div className="w-full max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
              <Presentation className="h-3.5 w-3.5" />
              <span className="truncate">{current.name}</span>
            </div>
            <div className="aspect-video overflow-y-auto rounded-xl border border-zinc-700 bg-gradient-to-br from-zinc-900 to-zinc-800/50 p-6 sm:p-10 shadow-xl shadow-black/40 scrollbar-thin">
              <div className="odf-body">
                <Blocks blocks={current.blocks} imgMap={imgMap} compact />
              </div>
            </div>
          </div>
        </ViewerBody>
      ) : (
        <ViewerBody className="p-4">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {parsed.pages.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { setPageIdx(i); setPageMode("page"); }}
                className="group aspect-video overflow-y-auto rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-800/40 p-3 text-left scrollbar-thin transition-colors hover:border-emerald-700/70"
              >
                <div className="odf-body">
                  <Blocks blocks={p.blocks} imgMap={imgMap} compact />
                </div>
                <span className="mt-2 block font-mono text-[9px] text-zinc-600 group-hover:text-emerald-500">{i + 1} · {p.name}</span>
              </button>
            ))}
          </div>
        </ViewerBody>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{fileName}</span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          {formatBytes(file.size)} · {detected.name} · {parsed.mime || "OpenDocument"}
        </span>
      </div>

      <style>{`
        .odf-body { color: #d4d4d8; font-size: 14px; line-height: 1.75; }
        .odf-body h1, .odf-body h2, .odf-body h3, .odf-body h4 { color: #fafafa; font-weight: 600; margin: 1em 0 0.4em; line-height: 1.3; }
        .odf-body .odf-h-1 { font-size: 1.7em; }
        .odf-body .odf-h-2 { font-size: 1.4em; }
        .odf-body .odf-h-3 { font-size: 1.2em; }
        .odf-body .odf-h-4 { font-size: 1.05em; }
        .odf-body p { margin: 0.55em 0; white-space: pre-wrap; }
        .odf-body ul { list-style: disc; padding-left: 1.5em; margin: 0.5em 0; }
        .odf-body li { margin: 0.25em 0; white-space: pre-wrap; }
        .odf-body img { max-width: 100%; border-radius: 6px; border: 1px solid #2c2c33; margin: 0.4em 0; }
        .odf-body table { border-collapse: collapse; margin: 0.8em 0; width: 100%; font-size: 12.5px; }
        .odf-body td { border: 1px solid #2c2c33; padding: 4px 8px; vertical-align: top; }
        .odf-body tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
      `}</style>
    </div>
  );
}

/* ------------------------------ block renderer ------------------------------ */

function Blocks({ blocks, imgMap, compact }: { blocks: Block[]; imgMap: Record<string, string>; compact?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h":
            return (
              <div key={i} className={cn("odf-h-" + Math.min(6, Math.max(1, b.level)), compact ? "mb-1 mt-2 first:mt-0" : "mb-1 mt-4 first:mt-0")}>
                {b.text}
              </div>
            );
          case "p":
            return <p key={i} className={compact ? "my-0.5" : undefined}>{b.text}</p>;
          case "list":
            return (
              <ul key={i}>
                {b.items.map((it, j) => <li key={j}>{it}</li>)}
              </ul>
            );
          case "table":
            return (
              <table key={i}>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            );
          case "image": {
            const url = imgMap[b.href];
            return url ? (
              <img key={i} src={url} alt="" className="mx-auto block max-h-[70vh]" />
            ) : (
              <div key={i} className="my-2 flex items-center justify-center gap-2 rounded border border-dashed border-zinc-700 py-6 text-[11px] text-zinc-500">
                <ImageIcon className="h-3.5 w-3.5" />
                embedded image ({b.href.split("/").pop()})
              </div>
            );
          }
        }
      })}
    </>
  );
}
