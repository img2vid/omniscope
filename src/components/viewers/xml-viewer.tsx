"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState, Segmented, Chip,
} from "./viewer-ui";
import { cn, formatNum } from "@/lib/utils";
import { Code2, ChevronDown, ChevronRight, Search, Copy, ListTree, Braces } from "lucide-react";

const MAX_XML = 4 * 1024 * 1024;

interface XmlNode {
  name: string;
  attrs: { name: string; value: string }[];
  children: XmlNode[];
  text: string;
}

function parseXmlDom(doc: Document): XmlNode {
  function conv(el: Element): XmlNode {
    const children: XmlNode[] = [];
    for (const child of Array.from(el.children)) children.push(conv(child));
    return {
      name: el.nodeName,
      attrs: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
      children,
      text: Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3 || n.nodeType === 4)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim(),
    };
  }
  const root = doc.documentElement;
  return root ? conv(root) : { name: "empty", attrs: [], children: [], text: "" };
}

function countXml(n: XmlNode): { el: number; attrs: number; depth: number } {
  let el = 1, attrs = n.attrs.length, depth = 1;
  let childDepth = 0;
  for (const c of n.children) {
    const r = countXml(c);
    el += r.el; attrs += r.attrs;
    childDepth = Math.max(childDepth, r.depth);
  }
  return { el, attrs, depth: depth + childDepth };
}

export default function XmlViewer({ arrayBuffer, head, fileName }: ViewerProps) {
  const [root, setRoot] = React.useState<XmlNode | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [raw, setRaw] = React.useState("");
  const [mode, setMode] = React.useState<"tree" | "raw">("tree");
  const [query, setQuery] = React.useState("");
  const [collapsedAll, setCollapsedAll] = React.useState(false);

  React.useEffect(() => {
    const bytes = (arrayBuffer ? new Uint8Array(arrayBuffer) : head).subarray(0, MAX_XML);
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    setRaw(text);
    try {
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.querySelector("parsererror")) {
        // try as HTML for lenient parsing
        const doc2 = new DOMParser().parseFromString(text, "text/html");
        if (doc2.body?.children?.length) setRoot(parseXmlDom(doc2));
        else throw new Error(doc.querySelector("parsererror")?.textContent?.slice(0, 200) || "XML parse error");
      } else {
        setRoot(parseXmlDom(doc));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  const matches = React.useMemo(() => {
    if (!root || !query.trim().toLowerCase()) return new Set<string>();
    const out = new Set<string>();
    const walk = (n: XmlNode, path: string) => {
      const hay = (n.name + " " + n.attrs.map((a) => a.name + "=" + a.value).join(" ") + " " + n.text).toLowerCase();
      if (hay.includes(query.trim().toLowerCase())) out.add(path);
      n.children.forEach((c, i) => walk(c, `${path}/${c.name}[${i}]`));
    };
    walk(root, root.name);
    return out;
  }, [root, query]);

  const stats = React.useMemo(() => (root ? countXml(root) : null), [root]);

  if (error) return <ErrorCard title="XML parse failed" message={error} hint="Falls back gracefully — try the Code viewer for the raw source." />;
  if (!root) return <LoadingState label="Parsing XML…" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">XML</Chip>
            {stats ? <Chip>{formatNum(stats.el)} elements</Chip> : null}
            {stats ? <Chip>{formatNum(stats.attrs)} attrs</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 w-full max-w-sm items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 pl-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes & attributes…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
            />
            {query ? <span className="shrink-0 px-1 text-[10px] text-emerald-400">{matches.size}</span> : null}
          </div>
        }
        right={
          <>
            <Segmented value={mode} onChange={setMode} options={[{ value: "tree", label: "Tree" }, { value: "raw", label: "Source" }]} />
            <ToolbarDivider />
            <ToolButton label="Collapse" onClick={() => setCollapsedAll((v) => !v)}><ListTree className="h-3.5 w-3.5" /></ToolButton>
            <ToolButton label="Copy" onClick={() => navigator.clipboard?.writeText(raw)}><Copy className="h-3.5 w-3.5" /></ToolButton>
          </>
        }
      />
      <ViewerBody className="p-3 font-mono text-[12.5px] leading-5">
        {mode === "raw" ? (
          <pre className="whitespace-pre-wrap break-words text-zinc-300">{raw || " "}</pre>
        ) : (
          <XmlNodeComp node={root} path={root.name} defaultOpen collapsedAll={collapsedAll} matches={matches} depth={0} />
        )}
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Code2 className="h-3.5 w-3.5" />
        {stats ? <span>depth {stats.depth} · root &lt;{root.name}&gt;</span> : null}
        <span className="ml-auto">{fileName}</span>
      </div>
    </div>
  );
}

function XmlNodeComp({
  node, path, defaultOpen, collapsedAll, matches, depth,
}: {
  node: XmlNode; path: string; defaultOpen: boolean; collapsedAll: boolean; matches: Set<string>; depth: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen && !collapsedAll && depth < 3);
  React.useEffect(() => {
    if (collapsedAll) setOpen(false);
  }, [collapsedAll]);
  const isMatch = matches.has(path);
  const childMatch = [...matches].some((m) => m.startsWith(path + "/"));
  const showChildren = open || childMatch;
  const hasChildren = node.children.length > 0;

  return (
    <div className="ml-0">
      <div className={cn("flex items-start gap-1 rounded px-0.5", isMatch && "bg-amber-900/25")}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label={showChildren ? "Collapse" : "Expand"}
          >
            {showChildren ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0 text-center text-zinc-700">·</span>
        )}
        <span>
          <span className="text-zinc-500">&lt;</span>
          <span className="text-emerald-300">{node.name}</span>
          {node.attrs.map((a) => (
            <span key={a.name}>
              &nbsp;<span className="text-violet-300">{a.name}</span>
              <span className="text-zinc-500">=</span>
              <span className="text-amber-300">"{a.value.length > 60 ? a.value.slice(0, 60) + "…" : a.value}"</span>
            </span>
          ))}
          <span className="text-zinc-500">&gt;</span>
          {!showChildren && hasChildren ? <span className="ml-1 text-zinc-600">…{node.children.length} child(ren)</span> : null}
        </span>
      </div>
      {showChildren && hasChildren ? (
        <div className="ml-5 border-l border-zinc-800/80 pl-2">
          {node.text ? <div className="whitespace-pre-wrap break-words text-zinc-300">{node.text}</div> : null}
          {node.children.map((c, i) => (
            <XmlNodeComp key={c.name + i} node={c} path={`${path}/${c.name}[${i}]`} defaultOpen={false} collapsedAll={collapsedAll} matches={matches} depth={depth + 1} />
          ))}
        </div>
      ) : (
        !hasChildren && node.text ? (
          <div className="ml-5 whitespace-pre-wrap break-words text-zinc-300">{node.text.length > 500 ? node.text.slice(0, 500) + "…" : node.text}</div>
        ) : null
      )}
      <div className="text-zinc-700">&lt;/{node.name}&gt;</div>
    </div>
  );
}
