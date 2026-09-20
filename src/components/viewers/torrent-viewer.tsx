"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, Copyable, ToolButton, ToolbarDivider,
} from "./viewer-ui";
import { cn, formatBytes, formatNum, formatDate, downloadBlob, toHex, isLikelyValidUtf8, latin1, sha1 } from "@/lib/utils";
import { Magnet, Globe, FileText, Hash, Download, Copy, Check, Layers, Radio } from "lucide-react";

/* ============================== bencode decoder ============================== */

interface BList { kind: "list"; items: { value: BValue; start: number; end: number }[]; }
interface BMapEntry { key: string; keyRaw: Uint8Array; value: BValue; valueStart: number; valueEnd: number; }
interface BDict { kind: "dict"; entries: BMapEntry[]; }
type BValue = number | Uint8Array | BList | BDict;

const TD = new TextDecoder();

function isBList(v: BValue | undefined | null): v is BList {
  return !!v && typeof v === "object" && "kind" in v && v.kind === "list";
}

function isBDict(v: BValue | undefined | null): v is BDict {
  return !!v && typeof v === "object" && "kind" in v && v.kind === "dict";
}

function bstr(bytes: Uint8Array): string {
  if (isLikelyValidUtf8(bytes.subarray(0, Math.min(bytes.length, 512)))) {
    return TD.decode(bytes);
  }
  return latin1(bytes);
}

function bdecode(b: Uint8Array, pos: number): { value: BValue; start: number; end: number } {
  const start = pos;
  if (pos >= b.length) throw new Error(`unexpected end at offset ${pos}`);
  const c = b[pos];
  if (c === 0x69) { // 'i' integer
    const end = b.indexOf(0x65, pos);
    if (end < 0) throw new Error("unterminated integer");
    const text = latin1(b.subarray(pos + 1, end));
    if (!/^-?\d+$/.test(text)) throw new Error(`bad integer “${text}”`);
    return { value: parseInt(text, 10), start, end: end + 1 };
  }
  if (c === 0x6c) { // 'l' list
    pos++;
    const items: { value: BValue; start: number; end: number }[] = [];
    while (true) {
      if (pos >= b.length) throw new Error("unterminated list");
      if (b[pos] === 0x65) break; // 'e'
      const r = bdecode(b, pos);
      items.push(r);
      pos = r.end;
    }
    return { value: { kind: "list", items }, start, end: pos + 1 };
  }
  if (c === 0x64) { // 'd' dict
    pos++;
    const entries: BMapEntry[] = [];
    while (true) {
      if (pos >= b.length) throw new Error("unterminated dictionary");
      if (b[pos] === 0x65) break; // 'e'
      const kr = bdecode(b, pos);
      if (!(kr.value instanceof Uint8Array)) throw new Error("dictionary key is not a string");
      pos = kr.end;
      const vr = bdecode(b, pos);
      pos = vr.end;
      entries.push({ key: bstr(kr.value), keyRaw: kr.value, value: vr.value, valueStart: vr.start, valueEnd: vr.end });
    }
    return { value: { kind: "dict", entries }, start, end: pos + 1 };
  }
  if (c >= 0x30 && c <= 0x39) { // "len:bytes" string
    const colon = b.indexOf(0x3a, pos);
    if (colon < 0) throw new Error("bad string header (missing ':')");
    const lenText = latin1(b.subarray(pos, colon));
    if (!/^\d+$/.test(lenText)) throw new Error(`bad string length “${lenText}”`);
    const len = parseInt(lenText, 10);
    if (colon + 1 + len > b.length) throw new Error("string extends beyond file");
    return { value: b.subarray(colon + 1, colon + 1 + len), start, end: colon + 1 + len };
  }
  throw new Error(`unexpected byte 0x${c.toString(16)} at offset ${pos}`);
}

function bget(dict: BValue | undefined, key: string): BMapEntry | undefined {
  if (!isBDict(dict)) return undefined;
  return dict.entries.find((e) => e.key === key);
}

function bnum(v: BValue | undefined): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function bstrv(v: BValue | undefined): string | undefined {
  return v instanceof Uint8Array ? bstr(v) : undefined;
}

/* ================================ model ================================ */

interface TorrentFile { path: string; size: number; }

interface TorrentModel {
  announce?: string;
  announceList: string[][];
  comment?: string;
  createdBy?: string;
  creationDate: number | null;
  name: string;
  isPrivate: boolean;
  pieceLength: number | null;
  pieceCount: number | null;
  firstPieceHash?: string;
  totalSize: number | null;
  files: TorrentFile[];
  infoRaw: Uint8Array | null;
  root: BValue;
  notes: string[];
}

function parseTorrent(b: Uint8Array): TorrentModel {
  const root = bdecode(b, 0).value;
  if (!isBDict(root)) throw new Error("Torrent root is not a bencoded dictionary.");
  const notes: string[] = [];
  const info = bget(root, "info");
  if (!info) throw new Error("Missing “info” dictionary — not a valid .torrent file.");

  const infoDict = info.value;
  if (!isBDict(infoDict)) throw new Error("“info” is not a dictionary.");

  const announce = bstrv(bget(root, "announce")?.value);
  const announceList: string[][] = [];
  const al = bget(root, "announce-list")?.value;
  if (isBList(al)) {
    for (const tier of al.items) {
      if (isBList(tier.value)) {
        const urls = tier.value.items.map((u) => (u.value instanceof Uint8Array ? bstr(u.value) : "")).filter(Boolean);
        if (urls.length) announceList.push(urls);
      }
    }
  }

  const name = bstrv(bget(infoDict, "name")?.value) ?? bstrv(bget(infoDict, "name.utf-8")?.value) ?? "(unnamed)";
  const isPrivate = bnum(bget(infoDict, "private")?.value) === 1;
  const pieceLength = bnum(bget(infoDict, "piece length")?.value) ?? null;
  const pieces = bget(infoDict, "pieces")?.value;
  const pieceCount = pieces instanceof Uint8Array ? Math.floor(pieces.length / 20) : null;
  const firstPieceHash = pieces instanceof Uint8Array && pieces.length >= 20 ? toHex(pieces.subarray(0, 20)).toLowerCase() : undefined;

  const files: TorrentFile[] = [];
  let totalSize: number | null = null;
  const filesList = bget(infoDict, "files")?.value;
  if (isBList(filesList)) {
    for (const f of filesList.items.slice(0, 20000)) {
      if (!isBDict(f.value)) continue;
      const pathEntry = bget(f.value, "path.utf-8")?.value ?? bget(f.value, "path")?.value;
      const len = bnum(bget(f.value, "length")?.value) ?? 0;
      const parts: string[] = [];
      if (isBList(pathEntry)) {
        for (const p of pathEntry.items) {
          if (p.value instanceof Uint8Array) parts.push(bstr(p.value));
        }
      }
      files.push({ path: parts.length ? parts.join("/") : "(unnamed file)", size: len });
    }
    totalSize = files.reduce((s, f) => s + f.size, 0);
  } else {
    const len = bnum(bget(infoDict, "length")?.value) ?? null;
    if (len != null) {
      files.push({ path: name, size: len });
      totalSize = len;
    }
  }
  if (!announce && !announceList.length) notes.push("No trackers — this may be a trackerless (DHT-only) torrent.");
  if (bget(infoDict, "meta version")) notes.push("BitTorrent v2 / hybrid layout detected — piece hashes use the merkle tree format.");
  return {
    announce,
    announceList,
    comment: bstrv(bget(root, "comment")?.value),
    createdBy: bstrv(bget(root, "created by")?.value),
    creationDate: bnum(bget(root, "creation date")?.value) ?? null,
    name,
    isPrivate,
    pieceLength,
    pieceCount,
    firstPieceHash,
    totalSize,
    files,
    infoRaw: b.subarray(info.valueStart, info.valueEnd),
    root,
    notes,
  };
}

/* ============================== JSON export ============================== */

function toJson(v: BValue): unknown {
  if (typeof v === "number") return v;
  if (v instanceof Uint8Array) {
    const cap = 48;
    const hex = toHex(v.subarray(0, cap)).toLowerCase();
    return v.length > cap ? `${hex}… (${v.length} bytes)` : hex;
  }
  if (isBList(v)) return v.items.map((i) => toJson(i.value));
  if (isBDict(v)) return Object.fromEntries(v.entries.map((e) => [e.key, toJson(e.value)]));
  return null;
}

/* ================================ viewer ================================ */

export default function TorrentViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [model, setModel] = React.useState<TorrentModel | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [infoHash, setInfoHash] = React.useState<string | null>(null);
  const [copiedMagnet, setCopiedMagnet] = React.useState(false);
  const [visibleFiles, setVisibleFiles] = React.useState(200);

  React.useEffect(() => {
    setErr(null);
    setModel(null);
    setInfoHash(null);
    setVisibleFiles(200);
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      setModel(parseTorrent(bytes));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  React.useEffect(() => {
    let cancelled = false;
    if (!model?.infoRaw) return;
    sha1(model.infoRaw).then((h) => {
      if (!cancelled && h !== "—") setInfoHash(h);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [model]);

  if (err) {
    return <ErrorCard title="Could not decode torrent" message={err} hint="The file may be corrupted or truncated — try the Hex viewer." />;
  }
  if (!model) return <LoadingState label="Decoding bencode…" />;

  const magnet = infoHash ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(model.name)}` : null;

  const modelOk: TorrentModel = model;

  function copyMagnet() {
    if (!magnet) return;
    navigator.clipboard?.writeText(magnet).then(() => {
      setCopiedMagnet(true);
      setTimeout(() => setCopiedMagnet(false), 1500);
    }).catch(() => {});
  }

  function exportJson() {
    const json = JSON.stringify(toJson(modelOk.root), null, 2);
    const base = fileName.replace(/\.torrent$/i, "") || "torrent";
    downloadBlob(json, `${base}.json`, "application/json");
  }

  const flatTrackers = model.announceList.flat();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><Magnet className="h-3 w-3" />BitTorrent</Chip>
            <Chip>{formatNum(model.pieceCount ?? 0)} pieces</Chip>
            {model.totalSize != null ? <Chip tone="teal">{formatBytes(model.totalSize)}</Chip> : null}
            {model.isPrivate ? <Chip tone="amber">private</Chip> : null}
            {model.files.length > 1 ? <Chip>{formatNum(model.files.length)} files</Chip> : null}
          </>
        }
        right={
          <>
            <ToolButton label="Copy magnet" onClick={copyMagnet} disabled={!magnet} title="Copy magnet URI">
              {copiedMagnet ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Export JSON" onClick={exportJson} title="Download the decoded dictionary as JSON">
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Tracker" icon={<Globe className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Announce" mono>
                  {model.announce ? <Copyable value={model.announce} /> : "— (DHT only)"}
                </Field>
                <Field label="Tiers">{formatNum(model.announceList.length)}</Field>
                {model.creationDate ? <Field label="Created">{formatDate(model.creationDate * 1000)}</Field> : null}
                {model.createdBy ? <Field label="Created by">{model.createdBy}</Field> : null}
                {model.comment ? <Field label="Comment">{model.comment}</Field> : null}
                <Field label="Private">{model.isPrivate ? "yes — DHT/PEX disabled" : "no"}</Field>
              </InfoGrid>
              {flatTrackers.length > (model.announce ? 1 : 0) ? (
                <div className="mt-3 flex max-h-28 flex-wrap gap-1.5 overflow-auto border-t border-zinc-800 pt-3 scrollbar-thin">
                  {flatTrackers.slice(0, 24).map((u, i) => (
                    <Chip key={i} tone="zinc">{u.replace(/^https?:\/\//, "").slice(0, 40)}</Chip>
                  ))}
                  {flatTrackers.length > 24 ? <Chip tone="zinc">+{formatNum(flatTrackers.length - 24)}</Chip> : null}
                </div>
              ) : null}
            </SectionCard>

            <SectionCard title="Info dictionary" icon={<Layers className="h-3.5 w-3.5" />}>
              <InfoGrid>
                <Field label="Name" mono>{model.name}</Field>
                <Field label="Piece length">{model.pieceLength != null ? formatBytes(model.pieceLength) : "—"}</Field>
                <Field label="Pieces">{model.pieceCount != null ? formatNum(model.pieceCount) : "—"}</Field>
                <Field label="Total size">{model.totalSize != null ? `${formatBytes(model.totalSize)} (${formatNum(model.totalSize)} B)` : "—"}</Field>
                <Field label="Files">{formatNum(model.files.length)}</Field>
                {model.firstPieceHash ? <Field label="Piece 0 SHA-1" mono><span className="break-all">{model.firstPieceHash}</span></Field> : null}
              </InfoGrid>
            </SectionCard>
          </div>

          <SectionCard title="Info hash & magnet" icon={<Hash className="h-3.5 w-3.5" />} right={infoHash ? <Chip tone="emerald">SHA-1 of raw info dict</Chip> : <Chip tone="amber">computing…</Chip>}>
            <InfoGrid>
              <Field label="Info hash" mono>
                {infoHash ? <Copyable value={infoHash} /> : "computing…"}
              </Field>
              <Field label="Magnet URI" mono>
                {magnet ? <Copyable value={magnet} /> : "waiting for hash…"}
              </Field>
            </InfoGrid>
            <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/50 p-2.5 font-mono text-[10px] leading-relaxed break-all text-zinc-400">
              {magnet ?? "—"}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              The info hash is the SHA-1 of the exact bencoded bytes of the <span className="font-mono text-zinc-400">info</span> dictionary —
              it is the identity trackers and DHT use. Computed locally with WebCrypto.
            </p>
          </SectionCard>

          {model.files.length ? (
            <SectionCard
              title="Files"
              icon={<FileText className="h-3.5 w-3.5" />}
              right={<Chip>{formatNum(model.files.length)}</Chip>}
            >
              <div className="max-h-[40vh] overflow-auto scrollbar-thin">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Path</th>
                      <th className="py-1 pr-2 text-right font-medium">Size</th>
                      <th className="hidden py-1 text-right font-medium sm:table-cell">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.files.slice(0, visibleFiles).map((f, i) => {
                      const share = model.totalSize ? (f.size / model.totalSize) * 100 : 0;
                      return (
                        <tr key={i} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                          <td className="py-1 pr-2 font-mono text-[11px] text-zinc-300">
                            <span className="text-zinc-600">{i + 1}. </span>{f.path}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(f.size)}</td>
                          <td className="hidden py-1 text-right tabular-nums text-zinc-500 sm:table-cell">{share.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {model.files.length > visibleFiles ? (
                <div className="pt-3">
                  <ToolButton
                    onClick={() => setVisibleFiles((v) => v + 200)}
                    label={`Show 200 more (${formatNum(model.files.length - visibleFiles)} hidden)`}
                    className="w-full justify-center border border-zinc-800"
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </ToolButton>
                </div>
              ) : null}
            </SectionCard>
          ) : (
            <EmptyHint>No file entries found in the info dictionary.</EmptyHint>
          )}

          {model.notes.length ? (
            <div className="space-y-1">
              {model.notes.map((n, i) => (
                <div key={i} className={cn("rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300/90")}>{n}</div>
              ))}
            </div>
          ) : null}
          {!arrayBuffer ? (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] leading-relaxed text-zinc-500">
              Parsed from the first 64 KB only (file exceeds the in-memory load cap) — piece data and later file entries may be missing.
            </div>
          ) : null}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Magnet className="h-3.5 w-3.5" />
        <span className="truncate">{model.name} · {formatBytes(file.size)} · {fileName}</span>
      </div>
    </div>
  );
}
