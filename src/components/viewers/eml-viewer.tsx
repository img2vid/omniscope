"use client";

import * as React from "react";
import DOMPurify from "dompurify";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ViewerBody, ErrorCard, LoadingState,
  Segmented, Chip, InfoGrid, Field, SectionCard, EmptyHint, Copyable,
} from "./viewer-ui";
import { latin1, isLikelyValidUtf8, downloadBlob, formatBytes, formatDate } from "@/lib/utils";
import {
  Mail, Paperclip, FileText, Image as ImageIcon, Layers, Download, Inbox, Globe, FileCode2,
} from "lucide-react";

/* ============================== data model ============================== */

interface Header { name: string; value: string; }

interface MimeNode {
  headers: Header[];
  contentType: string;              // lowercased main type, e.g. text/html
  params: Record<string, string>;   // charset, boundary, name…
  encoding: string;
  disposition: string;
  filename: string | null;
  contentId: string | null;
  location: string | null;
  raw: Uint8Array;                  // body bytes, still transfer-encoded
  children: MimeNode[] | null;      // non-null for multipart
  decodedBytes: Uint8Array | null;  // decoded transfer encoding (leaves)
  text: string | null;              // charset-decoded text (text/* leaves)
}

interface MailMessage {
  headers: Header[];
  node: MimeNode;
  mboxFrom: string;                 // raw "From " line (mbox only)
}

interface ParsedMail {
  kind: "eml" | "mht" | "mbox";
  messages: MailMessage[];
}

/* ============================== byte helpers ============================== */

function strBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function isHexCode(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}
function hexVal(c: number): number {
  return c <= 0x39 ? c - 0x30 : (c & 0xdf) - 0x41 + 10;
}

function decodeBase64Bytes(raw: Uint8Array): Uint8Array {
  const s = latin1(raw).replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    const chunks: string[] = [];
    const CH = 0x8000;
    for (let i = 0; i < s.length; i += CH) {
      let piece = s.slice(i, i + CH);
      const rem = piece.length % 4;
      if (rem && i + CH < s.length) piece = piece.slice(0, piece.length - rem);
      chunks.push(atob(piece));
    }
    const full = chunks.join("");
    const out = new Uint8Array(full.length);
    for (let i = 0; i < full.length; i++) out[i] = full.charCodeAt(i);
    return out;
  } catch {
    return raw; // corrupt base64 — best effort raw
  }
}

/** Quoted-Printable → bytes (RFC 2045 §6.7). */
function decodeQPBytes(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i];
    if (b === 0x3d) { // '='
      const h1 = i + 1 < raw.length ? raw[i + 1] : -1;
      const h2 = i + 2 < raw.length ? raw[i + 2] : -1;
      if (isHexCode(h1) && isHexCode(h2)) {
        out.push(hexVal(h1) * 16 + hexVal(h2));
        i += 2;
        continue;
      }
      if (h1 === 0x0d && h2 === 0x0a) { i += 2; continue; } // soft break CRLF
      if (h1 === 0x0a) { i += 1; continue; }                // soft break LF
      out.push(b); // stray '=' stays literal
    } else {
      out.push(b);
    }
  }
  return Uint8Array.from(out);
}

function decodeTransfer(raw: Uint8Array, encoding: string): Uint8Array {
  switch (encoding.trim().toLowerCase()) {
    case "base64":
      return decodeBase64Bytes(raw);
    case "quoted-printable":
      return decodeQPBytes(raw);
    default:
      return raw; // 7bit / 8bit / binary / unknown
  }
}

function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  let label = (charset ?? "utf-8").toLowerCase().trim();
  // common aliases TextDecoder doesn't know
  if (label === "ascii" || label === "us-ascii" || label === "" || label === "default") label = "utf-8";
  if (label.startsWith("iso-2022-jp")) label = "iso-2022-jp";
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    // unknown charset label — guess utf-8 vs latin1
    return isLikelyValidUtf8(bytes)
      ? new TextDecoder("utf-8", { fatal: false }).decode(bytes)
      : latin1(bytes);
  }
}

/* ============================== header parsing ============================== */

function splitHeadersBody(src: Uint8Array): { headers: Header[]; body: Uint8Array } {
  const text = latin1(src);
  const m = /\r?\n\r?\n/.exec(text);
  let headerText: string;
  let bodyStart: number;
  if (m) {
    headerText = text.slice(0, m.index);
    bodyStart = m.index + m[0].length;
  } else {
    // no blank line — either all headers or all body
    if (/^[A-Za-z0-9-]+[ \t]*:/.test(text)) {
      headerText = text;
      bodyStart = text.length;
    } else {
      headerText = "";
      bodyStart = 0;
    }
  }
  // unfold continuation lines
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  const headers: Header[] = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push({
      name: line.slice(0, colon).trim().toLowerCase(),
      value: line.slice(colon + 1).trim(),
    });
  }
  return { headers, body: src.subarray(bodyStart) };
}

function getHeader(headers: Header[], name: string): Header | undefined {
  return headers.find((h) => h.name === name);
}

/** Split "a;b=c" params (quote aware) → { b: "c" }. First segment is skipped. */
function parseParams(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = value.split(";");
  for (const p of parts.slice(1)) {
    const seg = p.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const key = seg.slice(0, eq).trim().toLowerCase();
    let val = seg.slice(eq + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/* ============================== mime tree ============================== */

function findBoundaryLines(text: string, delim: string): number[] {
  const res: number[] = [];
  let pos = 0;
  while (pos < text.length) {
    const i = text.indexOf(delim, pos);
    if (i < 0) break;
    const atLineStart = i === 0 || text[i - 1] === "\n";
    const after = text[i + delim.length];
    const isTerm = after === "-" && text[i + delim.length + 1] === "-";
    const lineEnd = after === undefined || after === "\r" || after === "\n" || isTerm;
    if (atLineStart && lineEnd) {
      res.push(i);
      pos = i + delim.length;
    } else {
      pos = i + 1;
    }
  }
  return res;
}

function splitMultipart(body: Uint8Array, boundary: string): Uint8Array[] {
  const text = latin1(body);
  const delim = "--" + boundary;
  const marks = findBoundaryLines(text, delim);
  const parts: Uint8Array[] = [];
  for (let k = 0; k < marks.length; k++) {
    const startLine = marks[k];
    // terminator "--boundary--" → stop
    if (text.startsWith(delim + "--", startLine)) break;
    let contentStart = startLine + delim.length;
    // skip to end of the boundary line
    const nl = text.indexOf("\n", contentStart);
    if (nl < 0) continue;
    contentStart = nl + 1;
    let end = k + 1 < marks.length ? marks[k + 1] : text.length;
    // strip the CRLF that precedes the next boundary
    if (end > contentStart && text[end - 1] === "\n") end--;
    if (end > contentStart && text[end - 1] === "\r") end--;
    if (end > contentStart) parts.push(body.subarray(contentStart, end));
  }
  return parts;
}

function parseMime(headers: Header[], body: Uint8Array): MimeNode {
  const ctHeader = getHeader(headers, "content-type")?.value ?? "text/plain; charset=us-ascii";
  const contentType = (ctHeader.split(";")[0] ?? "text/plain").trim().toLowerCase();
  const params = parseParams(ctHeader);
  const encoding = (getHeader(headers, "content-transfer-encoding")?.value ?? "").toLowerCase();
  const dispHeader = getHeader(headers, "content-disposition")?.value ?? "";
  const disposition = (dispHeader.split(";")[0] ?? "").trim().toLowerCase();
  const dispParams = parseParams(dispHeader);
  const filename = dispParams.filename ?? params.name ?? null;
  const contentId = (getHeader(headers, "content-id")?.value ?? "").replace(/[<>\s]/g, "") || null;
  const location = (getHeader(headers, "content-location")?.value ?? "").trim() || null;

  const node: MimeNode = {
    headers, contentType, params, encoding, disposition, filename, contentId, location,
    raw: body, children: null, decodedBytes: null, text: null,
  };

  if (contentType.startsWith("multipart/") && params.boundary) {
    node.children = splitMultipart(body, params.boundary).map((part) => {
      const { headers: h, body: b } = splitHeadersBody(part);
      return parseMime(h, b);
    });
  } else {
    node.decodedBytes = decodeTransfer(body, encoding);
    if (contentType.startsWith("text/") || contentType === "message/rfc822") {
      node.text = decodeCharset(node.decodedBytes, params.charset);
    }
  }
  return node;
}

function collectParts(node: MimeNode, out: MimeNode[]): void {
  out.push(node);
  if (node.children) for (const c of node.children) collectParts(c, out);
}

function splitMbox(bytes: Uint8Array): { msg: Uint8Array; from: string }[] {
  const text = latin1(bytes);
  const starts: number[] = [];
  for (let i = 0; i >= 0 && i < text.length; ) {
    if (text.startsWith("From ", i) && (i === 0 || text[i - 1] === "\n")) starts.push(i);
    const nl = text.indexOf("\n", i);
    if (nl < 0) break;
    i = nl + 1;
  }
  if (!starts.length) return [{ msg: bytes, from: "" }];
  const out: { msg: Uint8Array; from: string }[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : text.length;
    const chunk = bytes.subarray(starts[k], end);
    const nl = latin1(chunk).indexOf("\n");
    const fromLine = latin1(chunk.subarray(0, Math.max(0, nl)));
    const rest = nl >= 0 ? chunk.subarray(nl + 1) : chunk.subarray(0);
    out.push({ msg: rest, from: fromLine });
  }
  return out;
}

function parseMail(bytes: Uint8Array, ext: string): ParsedMail {
  const headText = latin1(bytes.subarray(0, 4096));
  const isMbox = ext === "mbox" || headText.startsWith("From ");
  if (isMbox) {
    const messages = splitMbox(bytes).map(({ msg, from }) => {
      const { headers, body } = splitHeadersBody(msg);
      return { headers, node: parseMime(headers, body), mboxFrom: from };
    });
    if (messages.length) return { kind: "mbox", messages };
  }
  const { headers, body } = splitHeadersBody(bytes);
  const node = parseMime(headers, body);
  const ct = node.contentType;
  const kind: ParsedMail["kind"] =
    ext === "mht" || ext === "mhtml" || (ct.startsWith("multipart/related") && node.children !== null)
      ? "mht"
      : "eml";
  return { kind, messages: [{ headers, node, mboxFrom: "" }] };
}

/* ============================ RFC 2047 words ============================ */

function decodeEncodedWords(s: string): string {
  if (!s.includes("=?")) return s;
  return s.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (whole, charset: string, enc: string, data: string) => {
    try {
      let bytes: Uint8Array;
      if (enc.toLowerCase() === "b") {
        bytes = decodeBase64Bytes(strBytes(data));
      } else {
        const q = data.replace(/_/g, " ");
        bytes = decodeQPBytes(strBytes(q));
      }
      return decodeCharset(bytes, charset.split("*")[0]);
    } catch {
      return whole;
    }
  });
}

/* ============================ view helpers ============================ */

interface Address { name: string; email: string; }

function parseAddresses(value: string): Address[] {
  if (!value) return [];
  const raw: string[] = [];
  // split on commas that are outside quotes and angle brackets (best effort)
  let depth = 0, inQ = false, cur = "";
  for (const ch of decodeEncodedWords(value)) {
    if (ch === '"') inQ = !inQ;
    if (!inQ) {
      if (ch === "<") depth++;
      else if (ch === ">") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) { raw.push(cur); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) raw.push(cur);
  return raw.map((s) => {
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
    if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim() };
    return { name: "", email: s.trim() };
  }).filter((a) => a.email || a.name);
}

function findBodyParts(root: MimeNode): { html: MimeNode | null; plain: MimeNode | null } {
  const all: MimeNode[] = [];
  collectParts(root, all);
  const usable = all.filter((n) => !n.children && n.decodedBytes && n.decodedBytes.length > 0 && !n.disposition.startsWith("attachment"));
  const html = usable.find((n) => n.contentType === "text/html") ?? null;
  const plain = usable.find((n) => n.contentType === "text/plain" || n.contentType === "text/markdown") ?? null;
  return { html, plain };
}

function isAttachmentNode(n: MimeNode): boolean {
  if (n.children) return false;
  if (n.disposition === "attachment") return true;
  if (n.filename) return true;
  if (n.contentType === "message/rfc822") return true;
  if (!n.contentType.startsWith("text/") && n.contentType !== "multipart/related") return true;
  return false;
}

function collectAttachments(root: MimeNode): MimeNode[] {
  const all: MimeNode[] = [];
  collectParts(root, all);
  return all.filter((n) => n.decodedBytes && n.decodedBytes.length > 0 && isAttachmentNode(n));
}

function partLabel(n: MimeNode, idx: number): string {
  if (n.filename) return n.filename;
  if (n.contentId) return `cid:${n.contentId}`;
  if (n.contentType.includes("html")) return "body.html";
  if (n.contentType.startsWith("text/")) return `body${idx}.txt`;
  return `part-${idx}`;
}

/** Map of reference (cid / content-location / filename, lowercased) → node. */
function buildRefMap(root: MimeNode): Map<string, MimeNode> {
  const map = new Map<string, MimeNode>();
  const all: MimeNode[] = [];
  collectParts(root, all);
  const add = (key: string | null | undefined, n: MimeNode) => {
    if (!key) return;
    const k = key.toLowerCase();
    if (!map.has(k)) map.set(k, n);
  };
  for (const n of all) {
    if (!n.decodedBytes || n.decodedBytes.length === 0 || n.children) continue;
    if (n.contentId) { add(`cid:${n.contentId}`, n); add(`<${n.contentId}>`, n); }
    if (n.location) {
      add(n.location, n);
      add(n.location.replace(/\\/g, "/"), n);
      const base = n.location.replace(/\\/g, "/").split("/").pop() ?? "";
      add(base, n);
    }
    if (n.filename) add(n.filename, n);
  }
  return map;
}

function basenameOf(u: string): string {
  const norm = u.replace(/\\/g, "/").split(/[?#]/)[0];
  return norm.split("/").pop() ?? "";
}

/* ================================ component =============================== */

const SOURCE_CAP = 300_000;

export default function EmlViewer({ arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [parsed, setParsed] = React.useState<ParsedMail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState(0);
  const [panel, setPanel] = React.useState<"body" | "parts" | "attachments" | "source">("body");
  const [bodyMode, setBodyMode] = React.useState<"html" | "plain">("html");

  React.useEffect(() => {
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      if (bytes.length === 0) throw new Error("File is empty");
      setParsed(parseMail(bytes, detected.ext ?? ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head, detected.ext]);

  const message = parsed ? (parsed.messages[selected] ?? parsed.messages[0]) : null;

  const bodies = React.useMemo(
    () => (message ? findBodyParts(message.node) : { html: null, plain: null }),
    [message],
  );
  const attachments = React.useMemo(() => (message ? collectAttachments(message.node) : []), [message]);
  const refMap = React.useMemo(() => (message ? buildRefMap(message.node) : null), [message]);

  const activeBody = bodyMode === "plain" && bodies.plain ? bodies.plain : bodies.html ?? bodies.plain;

  /* sanitized + reference-rewritten HTML */
  const [renderedHtml, setRenderedHtml] = React.useState<string | null>(null);
  const htmlNode = bodies.html;
  React.useEffect(() => {
    if (panel !== "body" || !htmlNode?.text) { setRenderedHtml(null); return; }
    let urls: string[] = [];
    let out = "";
    try {
      const clean = DOMPurify.sanitize(htmlNode.text, {
        FORBID_TAGS: ["style", "base", "form", "input", "button", "iframe"],
        FORBID_ATTR: ["srcset"],
      });
      const doc = new DOMParser().parseFromString(clean, "text/html");
      if (refMap) {
        const els = doc.querySelectorAll("[src],[href],[background]");
        for (const el of els) {
          const attr = el.hasAttribute("src") ? "src" : el.hasAttribute("href") ? "href" : "background";
          const val = (el.getAttribute(attr) ?? "").trim();
          if (!val || val.startsWith("#") || val.startsWith("data:")) continue;
          const key = val.toLowerCase();
          const base = basenameOf(val).toLowerCase();
          const part = refMap.get(key) ?? refMap.get(key.replace(/\\/g, "/")) ?? refMap.get(base);
          if (part?.decodedBytes) {
            const url = URL.createObjectURL(new Blob([part.decodedBytes as unknown as BlobPart], { type: part.contentType || "application/octet-stream" }));
            urls.push(url);
            el.setAttribute(attr, url);
          }
        }
      }
      out = doc.body.innerHTML;
    } catch {
      out = "";
    }
    setRenderedHtml(out);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
      urls = [];
    };
  }, [panel, htmlNode, refMap]);

  if (error) return <ErrorCard title="Could not parse email" message={error} hint="Expected RFC-822 .eml, .mht or .mbox content." />;
  if (!parsed || !message) return <LoadingState label="Parsing message…" />;

  const subject = decodeEncodedWords(getHeader(message.headers, "subject")?.value ?? "(no subject)");
  const from = parseAddresses(getHeader(message.headers, "from")?.value ?? "");
  const to = parseAddresses(getHeader(message.headers, "to")?.value ?? "");
  const cc = parseAddresses(getHeader(message.headers, "cc")?.value ?? "");
  const dateRaw = getHeader(message.headers, "date")?.value ?? "";
  const dateMs = dateRaw ? Date.parse(dateRaw) : NaN;
  const messageId = getHeader(message.headers, "message-id")?.value ?? "";
  const hasHtml = !!bodies.html;
  const hasPlain = !!bodies.plain;

  const sourceText = latin1(
    (arrayBuffer ? new Uint8Array(arrayBuffer) : head).subarray(0, SOURCE_CAP),
  );
  const sourceTruncated = (arrayBuffer ? arrayBuffer.byteLength : head.length) > SOURCE_CAP;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{parsed.kind === "mbox" ? "mbox" : parsed.kind === "mht" ? "MHT" : "EML"}</Chip>
            {parsed.kind === "mbox" ? <Chip tone="teal">{parsed.messages.length} messages</Chip> : null}
            {attachments.length ? (
              <Chip tone="amber"><Paperclip className="h-3 w-3" />{attachments.length}</Chip>
            ) : null}
          </>
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "body", label: "Body" },
              { value: "parts", label: "Parts" },
              { value: "attachments", label: `Attachments${attachments.length ? ` (${attachments.length})` : ""}` },
              { value: "source", label: "Source" },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto flex max-w-5xl gap-4">
          {parsed.kind === "mbox" ? (
            <aside className="sticky top-0 h-fit w-52 shrink-0">
              <SectionCard title="Mailbox" icon={<Inbox className="h-3.5 w-3.5" />} right={<Chip tone="zinc">{parsed.messages.length}</Chip>}>
                <div className="max-h-[60vh] space-y-1 overflow-y-auto scrollbar-thin">
                  {parsed.messages.map((m, i) => {
                    const mSubject = decodeEncodedWords(getHeader(m.headers, "subject")?.value ?? "(no subject)");
                    const mFrom = parseAddresses(getHeader(m.headers, "from")?.value ?? "");
                    const mDate = Date.parse(getHeader(m.headers, "date")?.value ?? "");
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelected(i)}
                        className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                          i === selected
                            ? "border-emerald-800/60 bg-emerald-900/30 text-emerald-200"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/60"
                        }`}
                      >
                        <div className="truncate font-medium">{mSubject}</div>
                        <div className="truncate text-zinc-500">
                          {mFrom[0]?.name || mFrom[0]?.email || `message ${i + 1}`}
                        </div>
                        {Number.isFinite(mDate) ? (
                          <div className="truncate text-[10px] text-zinc-600">{new Date(mDate).toLocaleDateString()}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </SectionCard>
            </aside>
          ) : null}

          <div className="min-w-0 flex-1 space-y-4">
            <SectionCard
              title="Message"
              icon={<Mail className="h-3.5 w-3.5" />}
              right={
                <div className="flex items-center gap-1.5">
                  {Number.isFinite(dateMs) ? <Chip tone="zinc">{formatDate(dateMs)}</Chip> : null}
                  {attachments.length ? <Chip tone="amber">{attachments.length} attachment{attachments.length > 1 ? "s" : ""}</Chip> : null}
                </div>
              }
            >
              <InfoGrid>
                <Field label="Subject">
                  <span className="font-semibold text-zinc-100">{subject}</span>
                </Field>
                <Field label="From">
                  <AddressList list={from} tone="emerald" />
                </Field>
                {to.length ? (
                  <Field label="To"><AddressList list={to} tone="zinc" /></Field>
                ) : null}
                {cc.length ? (
                  <Field label="Cc"><AddressList list={cc} tone="zinc" /></Field>
                ) : null}
                <Field label="Date">{Number.isFinite(dateMs) ? formatDate(dateMs) : dateRaw || "—"}</Field>
                {message.mboxFrom ? <Field label="mbox From" mono>{message.mboxFrom}</Field> : null}
                {messageId ? <Field label="Message-ID" mono><Copyable value={messageId} /></Field> : null}
                <Field label="Content-Type" mono>{message.node.contentType}{message.node.params.charset ? `; charset=${message.node.params.charset}` : ""}</Field>
              </InfoGrid>
              {arrayBuffer === null ? (
                <div className="mt-3 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
                  Large file — parsed from the first 64 KB only, message body may be truncated.
                </div>
              ) : null}
            </SectionCard>

            {panel === "body" ? (
              <SectionCard
                title="Body"
                icon={<FileText className="h-3.5 w-3.5" />}
                right={
                  hasHtml && hasPlain ? (
                    <Segmented
                      value={bodyMode}
                      onChange={setBodyMode}
                      options={[
                        { value: "html", label: "Html" },
                        { value: "plain", label: "Plain" },
                      ]}
                    />
                  ) : null
                }
              >
                {activeBody?.text ? (
                  activeBody.contentType === "text/html" ? (
                    renderedHtml !== null ? (
                      renderedHtml ? (
                        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-white p-4 text-[13px] leading-relaxed text-zinc-900">
                          <div className="email-body max-w-none break-words" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
                        </div>
                      ) : (
                        <EmptyHint>HTML body was empty or entirely stripped by the sanitizer.</EmptyHint>
                      )
                    ) : (
                      <EmptyHint>Rendering HTML body…</EmptyHint>
                    )
                  ) : (
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300 scrollbar-thin">
                      {activeBody.text.length > 400_000 ? `${activeBody.text.slice(0, 400_000)}\n… (truncated)` : activeBody.text}
                    </pre>
                  )
                ) : (
                  <EmptyHint>No readable body found in this message.</EmptyHint>
                )}
              </SectionCard>
            ) : null}

            {panel === "parts" ? (
              <SectionCard title="MIME structure" icon={<Layers className="h-3.5 w-3.5" />} right={<Chip tone="zinc">{countParts(message.node)} parts</Chip>}>
                <div className="space-y-1">
                  <PartRow node={message.node} depth={0} />
                </div>
              </SectionCard>
            ) : null}

            {panel === "attachments" ? (
              <SectionCard title="Attachments" icon={<Paperclip className="h-3.5 w-3.5" />}>
                {attachments.length ? (
                  <div className="space-y-1.5">
                    {attachments.map((a, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                        {a.contentType.startsWith("image/") ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-teal-400" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-zinc-200" title={partLabel(a, i)}>{partLabel(a, i)}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                            <Chip tone="zinc">{a.contentType}</Chip>
                            {a.encoding && a.encoding !== "7bit" ? <Chip tone="zinc">{a.encoding}</Chip> : null}
                            <span>{formatBytes(a.decodedBytes?.length ?? 0)}</span>
                          </div>
                        </div>
                        <ToolButton
                          label="Save"
                          onClick={() => {
                            const name = partLabel(a, i);
                            downloadBlob((a.decodedBytes ?? a.raw) as unknown as BlobPart, name, a.contentType || "application/octet-stream");
                          }}
                          title={`Download ${partLabel(a, i)}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </ToolButton>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyHint>No attachments in this message.</EmptyHint>
                )}
              </SectionCard>
            ) : null}

            {panel === "source" ? (
              <SectionCard
                title="Raw source"
                icon={<FileCode2 className="h-3.5 w-3.5" />}
                right={<Chip tone="zinc">{sourceTruncated ? `first ${Math.round(SOURCE_CAP / 1024)} KB` : "full file"}</Chip>}
              >
                <pre className="max-h-[65vh] overflow-auto whitespace-pre font-mono text-[11px] leading-relaxed text-zinc-400 scrollbar-thin">
                  {sourceText}
                </pre>
                {sourceTruncated ? (
                  <div className="mt-2 text-[11px] text-amber-300/80">Source preview truncated at {SOURCE_CAP / 1000} KB.</div>
                ) : null}
              </SectionCard>
            ) : null}
          </div>
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Globe className="h-3.5 w-3.5" />
        <span className="truncate">{subject} · {fileName}</span>
      </div>
    </div>
  );
}

function countParts(node: MimeNode): number {
  const all: MimeNode[] = [];
  collectParts(node, all);
  return all.length;
}

function AddressList({ list, tone }: { list: Address[]; tone: "emerald" | "zinc" }) {
  if (!list.length) return <span className="text-zinc-600">—</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {list.slice(0, 12).map((a, i) => (
        <span
          key={i}
          className={`inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[11px] ${
            tone === "emerald" ? "border-emerald-800/60 bg-emerald-900/30 text-emerald-200" : "border-zinc-700 bg-zinc-800/60 text-zinc-300"
          }`}
          title={a.email}
        >
          {a.name ? <span className="font-medium">{a.name}</span> : null}
          {a.name && a.email ? <span className="text-zinc-500">&lt;{a.email}&gt;</span> : a.email}
        </span>
      ))}
      {list.length > 12 ? <span className="text-[11px] text-zinc-500">+{list.length - 12} more</span> : null}
    </span>
  );
}

function PartRow({ node, depth }: { node: MimeNode; depth: number }) {
  const [open, setOpen] = React.useState(true);
  const isMultipart = !!node.children;
  const Icon = node.contentType.startsWith("image/") ? ImageIcon : isMultipart ? Layers : FileText;
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="shrink-0 font-mono text-zinc-300">{node.contentType || "text/plain"}</span>
        {node.params.charset ? <Chip tone="zinc">{node.params.charset}</Chip> : null}
        {node.encoding && node.encoding !== "7bit" ? <Chip tone="teal">{node.encoding}</Chip> : null}
        {node.disposition ? <Chip tone="zinc">{node.disposition}</Chip> : null}
        {node.filename ? <Chip tone="amber">{node.filename}</Chip> : null}
        {node.contentId ? <Chip tone="zinc">cid:{node.contentId}</Chip> : null}
        <span className="ml-auto shrink-0 text-zinc-500">{formatBytes(node.children ? node.raw.length : node.decodedBytes?.length ?? node.raw.length)}</span>
        {isMultipart ? (
          <ToolButton label={open ? "−" : "+"} onClick={() => setOpen((v) => !v)} title="Toggle children">
            {open ? "−" : "+"}
          </ToolButton>
        ) : null}
      </div>
      {isMultipart && open ? (
        <div className="mt-1 space-y-1 border-l border-zinc-800 pl-2">
          {node.children?.map((c, i) => <PartRow key={i} node={c} depth={0} />)}
        </div>
      ) : null}
    </div>
  );
}
