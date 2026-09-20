"use client";

import * as React from "react";
import type { FileTab } from "@/lib/types";
import { shannonEntropy, md5, sha256, sha1, crc32, formatBytes, formatDate, formatNum, toHex, downloadBlob, cn } from "@/lib/utils";
import { buildForensicReportHtml } from "@/lib/forensic-report";
import { FORMAT_STATS } from "@/lib/formats/stats";
import { VIEWER_LABELS } from "@/components/viewers/registry";
import { Chip, Copyable, Field, InfoGrid, SectionCard } from "@/components/viewers/viewer-ui";
import { Fingerprint, Hash, FileSearch, ShieldCheck, Download, Trash2, Zap, Copy, Check, FileText, BadgeCheck, ShieldX, FileCheck2, MinusCircle, ExternalLink } from "lucide-react";

const HASH_LIMIT = 50 * 1024 * 1024;

const ALGO_LABEL: Record<string, string> = { crc32: "CRC-32", md5: "MD5", sha1: "SHA-1", sha256: "SHA-256" };

/** parse a pasted checksum: bare hex (length tells the algorithm) or “sha256 <hex> …” sum-file lines */
function parseChecksum(input: string): { algo: "crc32" | "md5" | "sha1" | "sha256"; value: string } | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(crc-?32|md5|sha-?1|sha-?256)?[\s:]*([0-9a-f]+)(?:\s+\S+)?\s*$/);
  if (!m) return null;
  const prefix = (m[1] ?? "").replace(/-/g, "");
  const hex = m[2];
  const algo =
    prefix === "crc32" ? "crc32" :
    prefix === "md5" ? "md5" :
    prefix === "sha1" ? "sha1" :
    prefix === "sha256" ? "sha256" :
    hex.length === 8 ? "crc32" :
    hex.length === 32 ? "md5" :
    hex.length === 40 ? "sha1" :
    hex.length === 64 ? "sha256" :
    null;
  if (!algo) return null;
  const expectedLen = algo === "crc32" ? 8 : algo === "md5" ? 32 : algo === "sha1" ? 40 : 64;
  if (hex.length !== expectedLen) return null;
  return { algo, value: hex };
}

/* ------------------------- multi-line sum-file parsing ------------------------- */

interface SumEntry {
  algo: "crc32" | "md5" | "sha1" | "sha256";
  value: string;
  /** file name the line refers to (GNU "hash  name", BSD "MD5 (name) = hash") */
  fileName?: string;
  raw: string;
}

/**
 * Parse a whole sum file (sha256sum / md5sum / sha1sum / BSD “MD5 (file) = hash” /
 * sfv "name hash" lines). Returns one entry per recognized line; comments and
 * blank lines are skipped. Empty when nothing parses.
 * Exported for unit tests.
 */
export function parseSumFile(text: string): SumEntry[] {
  const out: SumEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // BSD style: MD5 (filename) = hex   /   SHA-256 (filename) = hex
    const bsd = line.match(/^(CRC-?32|MD5|SHA-?1|SHA-?256)\s*\(([^)]+)\)\s*=\s*([0-9a-fA-F]+)$/i);
    if (bsd) {
      const algo = bsd[1].replace(/-/g, "").toLowerCase();
      const value = bsd[3].toLowerCase();
      if ((ALGO_LABEL[algo]) && value.length === (algo === "crc32" ? 8 : algo === "md5" ? 32 : algo === "sha1" ? 40 : 64)) {
        out.push({ algo: algo as SumEntry["algo"], value, fileName: bsd[2], raw: rawLine });
        continue;
      }
    }
    // sfv style: filename hex
    const sfv = line.match(/^(\S+?)\s+([0-9a-fA-F]{8})$/i);
    if (sfv && !/^[0-9a-f]{8}$/i.test(sfv[1])) {
      out.push({ algo: "crc32", value: sfv[2].toLowerCase(), fileName: sfv[1], raw: rawLine });
      continue;
    }
    // GNU style: [algo ]hex [filename]  (also bare hex)
    const g = line.match(/^(?:(crc-?32|md5|sha-?1|sha-?256)[:\s]+)?([0-9a-fA-F]+)(?:\s+[*]?(\S.*))?$/i);
    if (!g) continue;
    const prefix = (g[1] ?? "").replace(/-/g, "").toLowerCase();
    const hex = g[2].toLowerCase();
    const algo =
      prefix === "crc32" ? "crc32" :
      prefix === "md5" ? "md5" :
      prefix === "sha1" ? "sha1" :
      prefix === "sha256" ? "sha256" :
      hex.length === 8 ? "crc32" :
      hex.length === 32 ? "md5" :
      hex.length === 40 ? "sha1" :
      hex.length === 64 ? "sha256" :
      null;
    if (!algo) continue;
    const expectedLen = algo === "crc32" ? 8 : algo === "md5" ? 32 : algo === "sha1" ? 40 : 64;
    if (hex.length !== expectedLen) continue;
    out.push({ algo, value: hex, fileName: g[3]?.trim(), raw: rawLine });
  }
  return out;
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/** compute the four digests for one file (head-only above HASH_LIMIT, same as the panel) */
async function hashFile(file: File, size: number): Promise<{ md5: string; sha1: string; sha256: string; crc32: string }> {
  const bytes = size <= HASH_LIMIT ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(await file.slice(0, 262144).arrayBuffer());
  const [s1, s256] = await Promise.all([sha1(bytes), sha256(bytes)]);
  return { md5: md5(bytes), sha1: s1, sha256: s256, crc32: crc32(bytes).toString(16).padStart(8, "0") };
}

export function InfoPanel({ tab, openTabs, onClose, onJumpToTab }: { tab: FileTab; openTabs?: FileTab[]; onClose: () => void; onJumpToTab?: (tabId: string) => void }) {
  const [hashes, setHashes] = React.useState<{ md5: string; sha1: string; sha256: string; crc32: string } | null>(null);
  const [entropy, setEntropy] = React.useState<number | null>(null);
  const [head, setHead] = React.useState<Uint8Array | null>(null);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [verifyInput, setVerifyInput] = React.useState("");
  const [verifyResult, setVerifyResult] = React.useState<null | { ok: boolean; algo: "crc32" | "md5" | "sha1" | "sha256"; expected: string; computed: string }>(null);
  const sumFileRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = new Uint8Array(await tab.file.slice(0, 262144).arrayBuffer());
      if (cancelled) return;
      setHead(h.subarray(0, 32));
      setEntropy(shannonEntropy(h));
      const bytes = tab.size <= HASH_LIMIT ? new Uint8Array(await tab.file.arrayBuffer()) : h;
      if (cancelled) return;
      const [s1, s256] = await Promise.all([sha1(bytes), sha256(bytes)]);
      if (cancelled) return;
      const c = crc32(bytes);
      setHashes({ md5: md5(bytes), sha1: s1, sha256: s256, crc32: c.toString(16).padStart(8, "0") });
    })();
    return () => { cancelled = true; };
  }, [tab]);

  /* ---------- sum-file mode across every open tab ---------- */
  const multiMode = openTabs != null && openTabs.length > 1;
  const [openHashes, setOpenHashes] = React.useState<Record<string, { name: string; size: number; hashes: { md5: string; sha1: string; sha256: string; crc32: string } }> | null>(null);
  const [openBusy, setOpenBusy] = React.useState(false);
  React.useEffect(() => {
    if (!multiMode) { setOpenHashes(null); setOpenBusy(false); return; }
    let cancelled = false;
    setOpenHashes(null);
    setOpenBusy(true);
    (async () => {
      const out: Record<string, { name: string; size: number; hashes: { md5: string; sha1: string; sha256: string; crc32: string } }> = {};
      for (const t of openTabs!.slice(0, 12)) {
        if (cancelled) return;
        try {
          out[t.id] = { name: t.name, size: t.size, hashes: await hashFile(t.file, t.size) };
        } catch { /* skip unreadable tabs */ }
      }
      if (cancelled) return;
      setOpenHashes(out);
      setOpenBusy(false);
    })();
    return () => { cancelled = true; };
  }, [multiMode, openTabs]);

  const copyAllChecksums = React.useCallback(() => {
    if (!hashes) return;
    const text = [
      `# ${tab.name} (${tab.size} bytes)`,
      `crc32  ${hashes.crc32}`,
      `md5    ${hashes.md5}`,
      `sha1   ${hashes.sha1}`,
      `sha256 ${hashes.sha256}`,
    ].join("\n");
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1600);
    }).catch(() => {});
  }, [hashes, tab.name, tab.size]);

  const downloadChecksums = React.useCallback(() => {
    if (!hashes) return;
    const text = [
      `# ${tab.name} (${tab.size} bytes) — computed locally in-browser (Omniscope)`,
      tab.size > HASH_LIMIT ? `# note: file exceeds ${formatBytes(HASH_LIMIT)} — hashes cover the first ${formatBytes(HASH_LIMIT)} only` : "",
      `crc32  ${hashes.crc32}`,
      `md5    ${hashes.md5}`,
      `sha1   ${hashes.sha1}`,
      `sha256 ${hashes.sha256}`,
    ].filter(Boolean).join("\n") + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = (tab.name.replace(/\.[^.]+$/, "") || "file") + ".checksums.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, [hashes, tab.name, tab.size]);

  const d = tab.detected;

  const parsedInput = React.useMemo(() => parseChecksum(verifyInput), [verifyInput]);

  /* sum-file mode: pasted/uploaded multi-line checksum lists verified live — against every open tab when provided */
  const sumEntries = React.useMemo(() => parseSumFile(verifyInput), [verifyInput]);
  const isSumMode = sumEntries.length > 1;
  const multiVerdicts = React.useMemo<
    { entry: SumEntry; status: "ok" | "bad" | "other"; matched?: string; computed?: string; matchedTabId?: string }[] | null
  >(() => {
    if (!isSumMode) return null;
    if (multiMode && !openHashes) return null; // still hashing the other tabs
    if (!hashes) return null;
    return sumEntries.map((entry) => {
      const base = entry.fileName ? baseName(entry.fileName) : null;
      if (multiMode && openHashes && base) {
        // match against every open tab (first hit wins on duplicate names)
        const lower = base.toLowerCase();
        const hit = Object.entries(openHashes).find(([, t]) => t.name.toLowerCase() === lower);
        if (!hit) return { entry, status: "other" as const };
        const [hitTabId, hitInfo] = hit;
        const computed = hitInfo.hashes[entry.algo];
        return { entry, status: computed === entry.value ? ("ok" as const) : ("bad" as const), matched: hitInfo.name, computed, matchedTabId: hitTabId };
      }
      const forThis = !base || base.toLowerCase() === tab.name.toLowerCase();
      if (!forThis) return { entry, status: "other" as const };
      const computed = hashes[entry.algo];
      return { entry, status: computed === entry.value ? ("ok" as const) : ("bad" as const), matched: tab.name, computed };
    });
  }, [isSumMode, sumEntries, hashes, tab.name, multiMode, openHashes]);
  const multiSummary = React.useMemo(() => {
    if (!multiVerdicts) return null;
    const ok = multiVerdicts.filter((v) => v.status === "ok").length;
    const bad = multiVerdicts.filter((v) => v.status === "bad").length;
    const other = multiVerdicts.length - ok - bad;
    return { ok, bad, other };
  }, [multiVerdicts]);

  const runVerify = React.useCallback(() => {
    if (!hashes || !parsedInput) { setVerifyResult(null); return; }
    const computed = hashes[parsedInput.algo];
    setVerifyResult({ ok: computed === parsedInput.value, algo: parsedInput.algo, expected: parsedInput.value, computed });
  }, [hashes, parsedInput]);

  const reportReady = hashes !== null && entropy !== null;

  const downloadReport = React.useCallback(() => {
    if (!hashes || entropy === null) return;
    const html = buildForensicReportHtml({
      fileName: tab.name,
      size: tab.size,
      lastModified: tab.file.lastModified,
      mime: tab.file.type || "(none declared)",
      formatName: d?.name,
      category: d?.cat,
      method: d?.method,
      ext: d?.ext,
      magicHex: d?.magicHex,
      conflicts: d?.conflicts,
      viewerLabel: d ? (VIEWER_LABELS[d.viewer] ?? d.viewer) : undefined,
      entropy,
      headHex: head ? toHex(head.subarray(0, 16)) + (head.length > 16 ? " " + toHex(head.subarray(16, 32)) : "") : undefined,
      hashes,
      hashPartial: tab.size > HASH_LIMIT,
      hashLimitBytes: HASH_LIMIT,
      tool: "OMNISCOPE",
      identities: FORMAT_STATS.identities,
    });
    downloadBlob(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      (tab.name.replace(/\.[^.]+$/, "") || "file") + ".report.html",
    );
  }, [hashes, entropy, head, tab, d]);

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-3 scrollbar-thin">
      <SectionCard
        title="File"
        icon={<FileSearch className="h-3.5 w-3.5" />}
        right={
          <div className="flex gap-1">
            <button
              type="button"
              onClick={downloadReport}
              disabled={!reportReady}
              title={reportReady ? "Download standalone forensic report (.html — printable)" : "Report ready once hashing finishes…"}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(tab.file);
                a.download = tab.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              }}
              title="Download"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-300"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close file"
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      >
        <InfoGrid>
          <Field label="Name" mono>{tab.name}</Field>
          <Field label="Size">{formatBytes(tab.size)}{tab.size >= 1000 ? ` (${formatNum(tab.size)} B)` : ""}</Field>
          <Field label="Modified">{formatDate(tab.file.lastModified)}</Field>
          <Field label="Type">{tab.file.type || "—"}</Field>
        </InfoGrid>
      </SectionCard>

      <SectionCard title="Identification" icon={<Fingerprint className="h-3.5 w-3.5" />}>
        {d ? (
          <>
            <InfoGrid>
              <Field label="Format">{d.name}</Field>
              <Field label="Category">{d.cat}</Field>
              <Field label="Detected by">
                <span className="flex flex-wrap items-center gap-1">
                  {d.method === "magic" || d.method === "container" ? (
                    <><Chip tone="emerald">{d.method}</Chip><span className="text-zinc-500">binary signature</span></>
                  ) : d.method === "extension" ? (
                    <><Chip tone="teal">extension</Chip><span className="text-zinc-580">.{d.ext}</span></>
                  ) : d.method === "content" ? (
                    <><Chip tone="amber">content</Chip><span className="text-zinc-500">sniffed</span></>
                  ) : (
                    <Chip tone="rose">unknown</Chip>
                  )}
                </span>
              </Field>
              <Field label="MIME" mono>{d.mime}</Field>
              {d.magicHex ? <Field label="Magic" mono><Copyable value={d.magicHex} className="text-emerald-300/90" /></Field> : null}
            </InfoGrid>
            {d.conflicts?.length ? (
              <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[10px] leading-relaxed text-amber-300">
                Extension claims {d.conflicts.join("; ")} — magic bytes took priority.
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> detecting…
          </div>
        )}
      </SectionCard>

      {entropy !== null ? (
        <SectionCard title="Analysis" icon={<Zap className="h-3.5 w-3.5" />}>
          <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span>entropy</span>
            <span className="font-mono text-zinc-300">{entropy.toFixed(3)} / 8</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
              style={{ width: `${(entropy / 8) * 100}%` }}
            />
          </div>
          {/* zone ticks: structured (4) · packed (6) · compressed/encrypted (7.2) */}
          <div className="relative mt-1 h-3.5 text-[9px] leading-none text-zinc-500" aria-hidden>
            {[4, 6, 7.2].map((z) => (
              <span key={z} className="absolute -translate-x-1/2" style={{ left: `${(z / 8) * 100}%` }}>
                <span className="absolute -top-1 left-1/2 h-1.5 w-px -translate-x-1/2 bg-zinc-600" />
                <span className="mt-1 block whitespace-nowrap font-mono">{z}</span>
              </span>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-zinc-500">
            {entropy >= 7.2 ? "high — likely compressed or encrypted" : entropy >= 6 ? "elevated — packed binary" : entropy >= 4 ? "medium — structured data" : "low — uniform / text-like"}
          </div>
          {head ? (
            <div className="mt-3">
              <div className="mb-1 text-[10px] text-zinc-500">first bytes</div>
              <div className="rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10px] leading-4 text-emerald-300">
                {toHex(head.subarray(0, 16))} {head.length > 16 ? toHex(head.subarray(16, 32)) : ""}
              </div>
            </div>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Checksums"
        icon={<Hash className="h-3.5 w-3.5" />}
        right={
          hashes ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={copyAllChecksums}
                title="Copy all checksums"
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-300"
              >
                {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={downloadChecksums}
                title="Download checksums.txt"
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-300"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : undefined
        }
      >
        {hashes ? (
          <>
            <InfoGrid>
              <Field label="CRC-32" mono><Copyable value={hashes.crc32} /></Field>
              <Field label="MD5" mono><Copyable value={hashes.md5} /></Field>
              <Field label="SHA-1" mono><Copyable value={hashes.sha1} /></Field>
              <Field label="SHA-256" mono><Copyable value={hashes.sha256} /></Field>
            </InfoGrid>
            {/* integrity verification workflow */}
            <div className="mt-3 border-t border-zinc-800 pt-3">
              {verifyOpen ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                      {isSumMode
                        ? multiMode
                          ? `Sum-file check · ${sumEntries.length} entries · ${Math.min(openTabs?.length ?? 0, 12)} open files`
                          : `Sum-file check · ${sumEntries.length} entries`
                        : "Verify against an expected checksum"}
                      {isSumMode && multiMode ? <span className="ml-1 normal-case tracking-normal text-zinc-500">· click a row to jump</span> : null}
                    </span>
                    <div className="flex items-center gap-1">
                      {!isSumMode ? (
                        <button
                          type="button"
                          onClick={() => sumFileRef.current?.click()}
                          title="Load a sum file (.sha256 / .md5 / .sha1 / .sfv)"
                          aria-label="Load a sum file"
                          className="rounded p-0.5 text-zinc-500 transition-colors hover:text-emerald-300"
                        >
                          <FileCheck2 className="h-3 w-3" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => { setVerifyOpen(false); setVerifyInput(""); setVerifyResult(null); }}
                        aria-label="Close checksum verifier"
                        className="rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <textarea
                      value={verifyInput}
                      onChange={(e) => { setVerifyInput(e.target.value); setVerifyResult(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && parsedInput && !isSumMode) { e.preventDefault(); runVerify(); } }}
                      placeholder={isSumMode ? undefined : "paste — 3b8a…, a sha256sum line, or a whole sum file"}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="Expected checksums"
                      rows={isSumMode ? Math.min(4, Math.ceil(verifyInput.length / 42)) : 2}
                      className="min-w-0 flex-1 resize-y rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-700 scrollbar-thin"
                    />
                    {!isSumMode ? (
                      <button
                        type="button"
                        onClick={runVerify}
                        disabled={!parsedInput}
                        className="inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border border-emerald-800/70 bg-emerald-950/40 px-2.5 text-[11px] font-medium text-emerald-300 transition-colors hover:border-emerald-600 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Verify
                      </button>
                    ) : null}
                    <input
                      ref={sumFileRef}
                      type="file"
                      className="hidden"
                      accept=".sha256,.sha1,.md5,.sfv,.asc,.txt,text/plain"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          f.text().then((t) => { setVerifyInput(t); setVerifyResult(null); }).catch(() => {});
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                  {isSumMode ? (
                    multiVerdicts && multiSummary ? (
                      <div className="space-y-1.5" role="status">
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                          <span className={cn(
                            "rounded-full border px-2 py-0.5 tabular-nums",
                            multiSummary.bad === 0
                              ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
                              : "border-rose-900/60 bg-rose-950/40 text-rose-300",
                          )}>
                            {multiSummary.bad === 0
                              ? `all ${multiSummary.ok} matching entr${multiSummary.ok === 1 ? "y" : "ies"} verified`
                              : `${multiSummary.bad} mismatch${multiSummary.bad === 1 ? "" : "es"} · ${multiSummary.ok} ok`}
                          </span>
                          {multiSummary.other > 0 ? (
                            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-400 tabular-nums" title={multiMode ? "entries whose file name matches none of the open tabs" : undefined}>
                              {multiSummary.other} {multiMode ? "not open" : "for other files"}
                            </span>
                          ) : null}
                          {tab.size > HASH_LIMIT ? (
                            <span className="rounded-full border border-amber-900/60 bg-amber-950/30 px-2 py-0.5 text-amber-300">head-only</span>
                          ) : null}
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/60 scrollbar-thin">
                          {multiVerdicts.map((v, i) => {
                            const jumpId = v.matchedTabId && onJumpToTab ? v.matchedTabId : null;
                            const rowCls = cn(
                              "flex w-full items-center gap-2 border-b border-zinc-900 px-2 py-1 font-mono text-[10px] last:border-b-0",
                              v.status === "ok" && "bg-emerald-950/20",
                              v.status === "bad" && "bg-rose-950/20",
                              jumpId && "cursor-pointer transition-colors hover:bg-zinc-800/70",
                            );
                            const content = (
                              <>
                                {v.status === "ok" ? <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
                                  : v.status === "bad" ? <ShieldX className="h-3 w-3 shrink-0 text-rose-400" aria-hidden />
                                  : <MinusCircle className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />}
                                <span className={cn(
                                  "shrink-0",
                                  v.status === "ok" ? "text-emerald-300" : v.status === "bad" ? "text-rose-300" : "text-zinc-500",
                                )}>
                                  {ALGO_LABEL[v.entry.algo]}
                                </span>
                                <span
                                  className={cn("min-w-0 flex-1 truncate text-left", v.status === "other" ? "text-zinc-600" : "text-zinc-400 group-hover/verdict:text-zinc-200")}
                                  title={v.entry.fileName ?? "(no file name on this line)"}
                                >
                                  {v.entry.fileName ?? "(no file name)"}
                                </span>
                                {multiMode && v.status === "other" ? (
                                  <span className="shrink-0 font-sans text-[9px] uppercase tracking-wide text-zinc-600">not open</span>
                                ) : (
                                  <span
                                    className="shrink-0 text-zinc-600"
                                    title={`expected ${v.entry.value}${v.status === "bad" ? `\ncomputed ${v.computed}` : "\nmatches"}`}
                                  >
                                    {v.entry.value.slice(0, 8)}…
                                  </span>
                                )}
                                {jumpId ? (
                                  <ExternalLink className="h-3 w-3 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover/verdict:opacity-100" aria-hidden />
                                ) : null}
                              </>
                            );
                            return jumpId ? (
                              <button
                                key={i}
                                type="button"
                                onClick={() => onJumpToTab?.(jumpId)}
                                title={`Open the ${v.matched} tab`}
                                aria-label={`Open the ${v.matched} tab`}
                                className={cn(rowCls, "group/verdict")}
                              >
                                {content}
                              </button>
                            ) : (
                              <div key={i} className={rowCls}>
                                {content}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        {openBusy ? (
                          <>
                            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                            hashing {Math.min(openTabs?.length ?? 0, 12)} open files…
                          </>
                        ) : (
                          "waiting for hashes…"
                        )}
                      </div>
                    )
                  ) : parsedInput ? (
                    <div className="text-[10px] text-zinc-500">
                      detected <span className="font-mono text-teal-300">{ALGO_LABEL[parsedInput.algo]}</span> · {parsedInput.value.length * 4}-bit digest
                    </div>
                  ) : verifyInput ? (
                    <div className="text-[10px] text-amber-500/90">
                      not a recognized checksum — expected bare hex (8/32/40/64 chars) or an “algo hash” sum-file line
                    </div>
                  ) : null}
                  {verifyResult ? (
                    verifyResult.ok ? (
                      <div
                        className="flex items-center gap-2 rounded-md border border-emerald-800/60 bg-emerald-950/30 px-2.5 py-2 text-[11px] text-emerald-300"
                        role="status"
                      >
                        <BadgeCheck className="h-4 w-4 shrink-0" />
                        <span>
                          <span className="font-semibold">{ALGO_LABEL[verifyResult.algo]}</span> checksum matches — integrity verified
                          {tab.size > HASH_LIMIT ? " (head only)" : ""}.
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-2.5 py-2 text-[11px] text-rose-300" role="alert">
                        <div className="flex items-center gap-2 font-semibold">
                          <ShieldX className="h-4 w-4 shrink-0" />
                          {ALGO_LABEL[verifyResult.algo]} mismatch — this file does not match the expected checksum
                          {tab.size > HASH_LIMIT ? " (head-only hashes — may be a false alarm on large files)" : ""}.
                        </div>
                        <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-rose-300/80">
                          <div className="truncate">expected&nbsp; {verifyResult.expected}</div>
                          <div className="truncate">computed {verifyResult.computed}</div>
                        </div>
                      </div>
                    )
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setVerifyOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[11px] text-zinc-400 transition-colors hover:border-emerald-800/60 hover:bg-emerald-950/20 hover:text-emerald-300"
                >
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                  Verify against an expected checksum…
                </button>
              )}
            </div>
            {tab.size > HASH_LIMIT ? (
              <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-900/50 bg-amber-950/20 p-1.5 text-[10px] leading-relaxed text-amber-300/90">
                <span className="mt-px shrink-0 font-mono">!</span>
                <span>File exceeds {formatBytes(HASH_LIMIT)} — hashes cover the first {formatBytes(HASH_LIMIT)} only.</span>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> hashing…
          </div>
        )}
      </SectionCard>

      <button
        type="button"
        onClick={downloadReport}
        disabled={!reportReady}
        className="group mt-1 flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left transition-colors hover:border-emerald-800/60 hover:bg-emerald-950/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-800 disabled:hover:bg-zinc-900/40"
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500 transition-colors group-hover:text-emerald-400" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-zinc-300 group-hover:text-emerald-200">Forensic report</span>
          <span className="block truncate text-[10px] leading-relaxed text-zinc-500">Printable .html — identification, entropy, checksums &amp; provenance</span>
        </span>
        <FileText className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-emerald-400" />
      </button>
    </div>
  );
}
