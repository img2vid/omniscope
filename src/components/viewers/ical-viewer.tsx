"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState,
  Segmented, Chip, InfoGrid, Field, SectionCard, EmptyHint,
} from "./viewer-ui";
import { decodeWith, isLikelyValidUtf8, formatNum } from "@/lib/utils";
import {
  CalendarDays, Users, MapPin, Clock, Bell, Repeat, Search, Phone, Mail,
  Building2, StickyNote, Cake, Link as LinkIcon, Home, UserRound,
} from "lucide-react";

/* ============================== line parsing ============================== */

interface ContentLine { name: string; params: Record<string, string>; value: string; }

/** Unfold RFC-5545/vCard continuation lines (leading space or tab). */
function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines.filter((l) => l.trim() !== "");
}

function parseContentLine(line: string): ContentLine | null {
  let inQ = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ":" && !inQ) { colon = i; break; }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs: string[] = [];
  let cur = "";
  inQ = false;
  for (const ch of head) {
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === ";" && !inQ) { segs.push(cur); cur = ""; continue; }
    cur += ch;
  }
  segs.push(cur);
  const name = (segs.shift() ?? "").toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const s of segs) {
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const key = s.slice(0, eq).toUpperCase();
    let v = s.slice(eq + 1);
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    params[key] = v;
  }
  return { name, params, value };
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/* ============================== ICS parsing ============================== */

interface IcsDate {
  ms: number | null;       // epoch millis for sorting (best effort)
  raw: string;
  allDay: boolean;
  hasTime: boolean;
  tzid?: string;
  utc: boolean;
}

interface VEvent {
  summary: string;
  location?: string;
  description?: string;
  start?: IcsDate;
  end?: IcsDate;
  duration?: string;
  rrule?: string;
  uid?: string;
  status?: string;
  categories?: string;
  alarms: number;
}

function parseIcsDate(value: string, params: Record<string, string>): IcsDate {
  const v = value.trim();
  const allDay = params.VALUE === "DATE" || /^\d{8}$/.test(v);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v);
  if (!m) return { ms: null, raw: v, allDay, hasTime: false, utc: false, tzid: params.TZID };
  const [, y, mo, d, h, mi, s, z] = m;
  const hasTime = !!h;
  if (!hasTime || allDay) {
    return {
      ms: Date.UTC(+y, +mo - 1, +d),
      raw: v, allDay: true, hasTime: false, tzid: params.TZID, utc: false,
    };
  }
  const y0 = +y, mo0 = +mo - 1, d0 = +d, h0 = +h, mi0 = +mi, s0 = +s;
  if (z) {
    return {
      ms: Date.UTC(y0, mo0, d0, h0, mi0, s0),
      raw: v, allDay: false, hasTime: true, utc: true, tzid: undefined,
    };
  }
  if (params.TZID) {
    const tz = zonedToUtc(y0, mo0, d0, h0, mi0, s0, params.TZID);
    if (tz !== null) {
      return { ms: tz.getTime(), raw: v, allDay: false, hasTime: true, tzid: params.TZID, utc: false };
    }
  }
  return {
    ms: new Date(y0, mo0, d0, h0, mi0, s0).getTime(),
    raw: v, allDay: false, hasTime: true, tzid: params.TZID, utc: false,
  };
}

/** Convert wall-clock time in `tzid` to a real UTC Date (Intl-based best effort). */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tzid: string): Date | null {
  try {
    const guess = Date.UTC(y, mo, d, h, mi, s);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tzid, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(guess))) parts[p.type] = p.value;
    const asUtc = Date.UTC(
      +parts.year, +parts.month - 1, +parts.day,
      (+parts.hour || 0) % 24, +parts.minute, +parts.second,
    );
    if (!Number.isFinite(asUtc)) return null;
    const offset = asUtc - guess;
    return new Date(guess - offset);
  } catch {
    return null;
  }
}

function formatIcsDate(d: IcsDate | undefined): string {
  if (!d) return "—";
  if (d.ms === null) return d.raw;
  const date = new Date(d.ms);
  if (d.allDay || !d.hasTime) {
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  }
  if (d.utc) {
    return `${date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })}, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
  }
  return `${date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}, ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

interface IcsFile { events: VEvent[]; todos: number; journals: number; timezoneBlocks: number; }

function parseIcs(text: string): IcsFile {
  const lines = unfoldLines(text);
  const events: VEvent[] = [];
  let todos = 0, journals = 0, timezoneBlocks = 0;
  let cur: VEvent | null = null;
  let inAlarm = false;
  let depth = "";

  for (const line of lines) {
    const cl = parseContentLine(line);
    if (!cl) continue;
    if (cl.name === "BEGIN") {
      const block = cl.value.trim().toUpperCase();
      depth = block;
      if (block === "VEVENT") {
        cur = { summary: "", alarms: 0 };
      } else if (block === "VALARM") {
        inAlarm = true;
        if (cur) cur.alarms++;
      } else if (block === "VTODO") todos++;
      else if (block === "VJOURNAL") journals++;
      else if (block === "VTIMEZONE") timezoneBlocks++;
      continue;
    }
    if (cl.name === "END") {
      const block = cl.value.trim().toUpperCase();
      if (block === "VEVENT" && cur) {
        events.push(cur);
        cur = null;
      } else if (block === "VALARM") {
        inAlarm = false;
      }
      depth = "";
      continue;
    }
    if (!cur) continue;
    if (inAlarm) continue; // alarm inner properties ignored (counted on BEGIN)
    switch (cl.name) {
      case "SUMMARY":
        cur.summary = unescapeText(cl.value);
        break;
      case "LOCATION":
        cur.location = unescapeText(cl.value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(cl.value);
        break;
      case "DTSTART":
        cur.start = parseIcsDate(cl.value, cl.params);
        break;
      case "DTEND":
        cur.end = parseIcsDate(cl.value, cl.params);
        break;
      case "DURATION":
        cur.duration = cl.value;
        break;
      case "RRULE":
        cur.rrule = cl.value;
        break;
      case "UID":
        cur.uid = cl.value;
        break;
      case "STATUS":
        cur.status = cl.value;
        break;
      case "CATEGORIES":
        cur.categories = cl.value;
        break;
      default:
        break;
    }
  }
  return { events, todos, journals, timezoneBlocks };
}

/* ============================== VCF parsing ============================== */

interface VCardEntry { value: string; types: string[]; }
interface VCard {
  fn?: string;
  family?: string; given?: string; middle?: string; prefix?: string; suffix?: string;
  org?: string; title?: string;
  tels: VCardEntry[];
  emails: VCardEntry[];
  adrs: VCardEntry[];
  note?: string;
  photo?: string;
  bday?: string;
  nickname?: string;
  url?: string;
  version?: string;
  label?: string;
}

function parseVcards(text: string): VCard[] {
  const lines = unfoldLines(text);
  const cards: VCard[] = [];
  let cur: VCard | null = null;
  for (const line of lines) {
    const cl = parseContentLine(line);
    if (!cl) continue;
    const rawName = cl.name;
    // strip group prefix like "item1." — parseContentLine already split on ";",
    // a group prefix appears as "item1.TEL" in one segment
    const name = rawName.includes(".") ? rawName.split(".").pop() ?? rawName : rawName;
    if (name === "BEGIN" && cl.value.trim().toUpperCase() === "VCARD") {
      cur = { tels: [], emails: [], adrs: [] };
      continue;
    }
    if (name === "END" && cl.value.trim().toUpperCase() === "VCARD") {
      if (cur) cards.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const types = (cl.params.TYPE ?? "")
      .split(",")
      .map((t) => t.replace(/"/g, "").trim().toLowerCase())
      .filter(Boolean);
    switch (name) {
      case "FN":
        cur.fn = unescapeText(cl.value);
        break;
      case "N": {
        const p = cl.value.split(";");
        cur.family = p[0] ?? ""; cur.given = p[1] ?? ""; cur.middle = p[2] ?? "";
        cur.prefix = p[3] ?? ""; cur.suffix = p[4] ?? "";
        break;
      }
      case "ORG":
        cur.org = unescapeText(cl.value.split(";").filter(Boolean).join(" · "));
        break;
      case "TITLE":
        cur.title = unescapeText(cl.value);
        break;
      case "TEL":
        cur.tels.push({ value: cl.value, types });
        break;
      case "EMAIL":
        cur.emails.push({ value: cl.value, types });
        break;
      case "ADR":
        cur.adrs.push({ value: cl.value, types });
        break;
      case "NOTE":
        cur.note = unescapeText(cl.value);
        break;
      case "BDAY":
        cur.bday = cl.value;
        break;
      case "NICKNAME":
        cur.nickname = unescapeText(cl.value);
        break;
      case "URL":
        cur.url = cl.value;
        break;
      case "VERSION":
        cur.version = cl.value;
        break;
      case "LABEL":
        cur.label = unescapeText(cl.value);
        break;
      case "PHOTO": {
        const v = cl.value.trim();
        const rawMime = (cl.params.TYPE ?? "jpeg").toLowerCase();
        const mime = rawMime.includes("/") ? rawMime : `image/${rawMime}`;
        if (v.toLowerCase().startsWith("data:")) {
          cur.photo = v;
        } else if ((cl.params.ENCODING ?? "").toLowerCase() === "b" || (cl.params.ENCODING ?? "").toLowerCase() === "base64") {
          cur.photo = `data:${mime};base64,${v.replace(/\s/g, "")}`;
        }
        break;
      }
      default:
        break;
    }
  }
  return cards;
}

function addressPretty(v: string): string {
  const p = v.split(";");
  const [po, ext, street, city, region, zip, country] = p;
  const parts = [street, `${city || ""}${city && region ? ", " : ""}${region || ""}`, zip, country, po, ext]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return parts.join(", ");
}

/* ================================ component =============================== */

export default function IcalViewer({ arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [error, setError] = React.useState<string | null>(null);
  const [ics, setIcs] = React.useState<IcsFile | null>(null);
  const [vcards, setVcards] = React.useState<VCard[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<"calendar" | "contacts">("calendar");

  React.useEffect(() => {
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      if (bytes.length === 0) throw new Error("File is empty");
      const label = isLikelyValidUtf8(bytes) ? "utf-8" : "windows-1252";
      const text = decodeWith(bytes, label);
      const lower = text.slice(0, 200).toUpperCase();
      const hasVevent = /BEGIN:VEVENT/.test(text.toUpperCase());
      const hasVcard = /BEGIN:VCARD/.test(text.toUpperCase());
      if (!hasVevent && !hasVcard && !lower.includes("BEGIN:VCALENDAR") && !lower.includes("BEGIN:VCARD")) {
        throw new Error("No VEVENT or VCARD blocks found — expected ICS/VCS calendar or VCF contacts");
      }
      setIcs(hasVevent || lower.includes("BEGIN:VCALENDAR") ? parseIcs(text) : { events: [], todos: 0, journals: 0, timezoneBlocks: 0 });
      setVcards(hasVcard ? parseVcards(text) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  React.useEffect(() => {
    if (ics && vcards) {
      const wantContacts = detected.viewer === "vcf";
      if (wantContacts && vcards.length) setTab("contacts");
      else if (ics.events.length) setTab("calendar");
      else if (vcards.length) setTab("contacts");
    }
  }, [ics, vcards, detected.viewer]);

  const filteredEvents = React.useMemo(() => {
    if (!ics) return [];
    const q = query.trim().toLowerCase();
    const sorted = [...ics.events].sort((a, b) => {
      const am = a.start?.ms ?? Infinity;
      const bm = b.start?.ms ?? Infinity;
      return am - bm;
    });
    if (!q) return sorted;
    return sorted.filter((e) =>
      `${e.summary} ${e.location ?? ""} ${e.description ?? ""}`.toLowerCase().includes(q));
  }, [ics, query]);

  const filteredCards = React.useMemo(() => {
    if (!vcards) return [];
    const q = query.trim().toLowerCase();
    if (!q) return vcards;
    return vcards.filter((c) =>
      `${c.fn ?? ""} ${c.given ?? ""} ${c.family ?? ""} ${c.org ?? ""} ${c.title ?? ""} ${c.nickname ?? ""} ${c.emails.map((e) => e.value).join(" ")} ${c.tels.map((t) => t.value).join(" ")}`
        .toLowerCase()
        .includes(q));
  }, [vcards, query]);

  const monthGroups = React.useMemo(() => {
    const groups: { key: string; label: string; events: VEvent[] }[] = [];
    for (const e of filteredEvents) {
      const ms = e.start?.ms;
      const key = ms !== null && ms !== undefined && Number.isFinite(ms)
        ? new Date(ms).toISOString().slice(0, 7)
        : "undated";
      const label = key === "undated"
        ? "Undated"
        : new Date(ms ?? 0).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, label, events: [] }; groups.push(g); }
      g.events.push(e);
    }
    return groups;
  }, [filteredEvents]);

  if (error) return <ErrorCard title="Could not parse calendar/contacts file" message={error} hint="Expected an iCalendar .ics/.vcs or vCard .vcf file." />;
  if (!ics || !vcards) return <LoadingState label="Parsing calendar…" />;

  const recurring = ics.events.filter((e) => e.rrule).length;
  const withAlarms = ics.events.filter((e) => e.alarms > 0).length;
  const spanFrom = ics.events.map((e) => e.start?.ms).filter((m): m is number => typeof m === "number" && Number.isFinite(m));
  const spanTo = ics.events.map((e) => (e.end?.ms ?? e.start?.ms)).filter((m): m is number => typeof m === "number" && Number.isFinite(m));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{detected.ext ? detected.ext.toUpperCase() : "ICS/VCF"}</Chip>
            {ics.events.length ? <Chip tone="teal">{formatNum(ics.events.length)} events</Chip> : null}
            {vcards.length ? <Chip tone="teal">{formatNum(vcards.length)} contacts</Chip> : null}
          </>
        }
        center={
          <div className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "calendar" ? "Filter events…" : "Filter contacts…"}
              className="w-24 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none sm:w-44"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} className="text-zinc-500 hover:text-zinc-300" aria-label="Clear">✕</button>
            ) : null}
          </div>
        }
        right={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "calendar", label: `Calendar (${ics.events.length})` },
              { value: "contacts", label: `Contacts (${vcards.length})` },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {arrayBuffer === null ? (
            <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
              Large file — only the first 64 KB were loaded, content may be truncated.
            </div>
          ) : null}

          {tab === "calendar" ? (
            ics.events.length ? (
              <>
                <SectionCard title="Calendar statistics" icon={<CalendarDays className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Events">{formatNum(ics.events.length)}</Field>
                    <Field label="Recurring">{formatNum(recurring)}</Field>
                    <Field label="With alarms">{formatNum(withAlarms)}</Field>
                    {spanFrom.length ? (
                      <Field label="Span">
                        {new Date(Math.min(...spanFrom)).toLocaleDateString()} → {new Date(Math.max(...spanTo)).toLocaleDateString()}
                      </Field>
                    ) : null}
                    {ics.todos ? <Field label="Todos">{formatNum(ics.todos)}</Field> : null}
                    {ics.journals ? <Field label="Journals">{formatNum(ics.journals)}</Field> : null}
                    {ics.timezoneBlocks ? <Field label="Timezones">{formatNum(ics.timezoneBlocks)}</Field> : null}
                  </InfoGrid>
                </SectionCard>

                {monthGroups.map((g) => (
                  <SectionCard
                    key={g.key}
                    title={g.label}
                    icon={<CalendarDays className="h-3.5 w-3.5" />}
                    right={<Chip tone="zinc">{g.events.length}</Chip>}
                  >
                    <div className="space-y-2">
                      {g.events.map((e, i) => (
                        <EventCard key={i} ev={e} />
                      ))}
                    </div>
                  </SectionCard>
                ))}
                {!filteredEvents.length ? <EmptyHint>No events match “{query}”.</EmptyHint> : null}
              </>
            ) : (
              <EmptyHint>No calendar events in this file.</EmptyHint>
            )
          ) : (
            vcards.length ? (
              <>
                <SectionCard title="Contacts statistics" icon={<Users className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Contacts">{formatNum(vcards.length)}</Field>
                    <Field label="With photos">{formatNum(vcards.filter((c) => c.photo).length)}</Field>
                    <Field label="With orgs">{formatNum(vcards.filter((c) => c.org).length)}</Field>
                    <Field label="Phone numbers">{formatNum(vcards.reduce((a, c) => a + c.tels.length, 0))}</Field>
                    <Field label="Emails">{formatNum(vcards.reduce((a, c) => a + c.emails.length, 0))}</Field>
                    <Field label="Addresses">{formatNum(vcards.reduce((a, c) => a + c.adrs.length, 0))}</Field>
                  </InfoGrid>
                </SectionCard>
                <div className="grid gap-3 sm:grid-cols-2">
                  {filteredCards.map((c, i) => (
                    <ContactCard key={i} card={c} />
                  ))}
                </div>
                {!filteredCards.length ? <EmptyHint>No contacts match “{query}”.</EmptyHint> : null}
              </>
            ) : (
              <EmptyHint>No vCard contacts in this file.</EmptyHint>
            )
          )}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <UserRound className="h-3.5 w-3.5" />
        <span className="truncate">
          {tab === "calendar"
            ? `${ics.events.length} events${recurring ? ` · ${recurring} recurring` : ""}`
            : `${vcards.length} contacts`}{" "}
          · {fileName}
        </span>
      </div>
    </div>
  );
}

/* ================================ sub views ================================ */

function EventCard({ ev }: { ev: VEvent }) {
  const [expanded, setExpanded] = React.useState(false);
  const freq = ev.rrule ? /FREQ=([A-Z]+)/i.exec(ev.rrule)?.[1] : null;
  const rruleParts = ev.rrule ? ev.rrule.split(";").filter(Boolean).length : 0;
  const descShort = ev.description && ev.description.length > 400 && !expanded
    ? `${ev.description.slice(0, 400)}…`
    : ev.description;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">{ev.summary || "(untitled event)"}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-emerald-500" />
              {formatIcsDate(ev.start)}
              {ev.end || ev.duration ? <span className="text-zinc-600">→ {ev.duration ? `dur ${ev.duration}` : formatIcsDate(ev.end)}</span> : null}
            </span>
            {ev.start?.tzid ? <Chip tone="zinc">{ev.start.tzid}</Chip> : null}
            {ev.start?.allDay ? <Chip tone="zinc">all-day</Chip> : null}
          </div>
          {ev.location ? (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-zinc-400">
              <MapPin className="h-3 w-3 shrink-0 text-teal-500" />
              <span className="truncate">{ev.location}</span>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {freq ? (
            <Chip tone="emerald" className="max-w-none">
              <Repeat className="h-3 w-3" />
              {freq}
              {rruleParts > 1 ? ` +${rruleParts - 1}` : ""}
            </Chip>
          ) : null}
          {ev.alarms > 0 ? (
            <Chip tone="amber"><Bell className="h-3 w-3" />{ev.alarms}</Chip>
          ) : null}
          {ev.status ? <Chip tone="zinc">{ev.status}</Chip> : null}
          {ev.categories ? <Chip tone="teal" className="max-w-[10rem]">{ev.categories}</Chip> : null}
        </div>
      </div>
      {ev.description ? (
        <div className="mt-2 border-t border-zinc-800/60 pt-2">
          <p className="whitespace-pre-line break-words text-[11px] leading-relaxed text-zinc-400">{descShort}</p>
          {ev.description.length > 400 ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function initialsOf(card: VCard): string {
  const src = card.fn || `${card.given ?? ""} ${card.family ?? ""}`.trim() || card.org || "?";
  const words = src.split(/\s+/).filter(Boolean);
  const a = words[0]?.[0] ?? "?";
  const b = words.length > 1 ? words[1][0] : "";
  return (a + b).toUpperCase();
}

function ContactCard({ card }: { card: VCard }) {
  const name = card.fn || [card.given, card.family].filter(Boolean).join(" ") || card.nickname || "(unnamed)";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-start gap-3">
        {card.photo ? (
          <img
            src={card.photo}
            alt={name}
            className="h-14 w-14 shrink-0 rounded-full border border-zinc-700 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-emerald-800/50 bg-emerald-900/30 text-base font-semibold text-emerald-300">
            {initialsOf(card)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{name}</div>
          {card.nickname ? <div className="text-[11px] text-zinc-500">“{card.nickname}”</div> : null}
          {card.org || card.title ? (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400">
              <Building2 className="h-3 w-3 shrink-0 text-teal-500" />
              <span className="truncate">{[card.title, card.org].filter(Boolean).join(" · ")}</span>
            </div>
          ) : null}
          <div className="mt-1.5 space-y-1 text-[11px]">
            {card.tels.slice(0, 3).map((t, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Phone className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="truncate text-zinc-300">{t.value}</span>
                {t.types.length ? <span className="shrink-0 text-[10px] text-zinc-600">{t.types.join("/")}</span> : null}
              </div>
            ))}
            {card.emails.slice(0, 3).map((t, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Mail className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="truncate text-zinc-300">{t.value}</span>
                {t.types.length ? <span className="shrink-0 text-[10px] text-zinc-600">{t.types.join("/")}</span> : null}
              </div>
            ))}
            {card.adrs.slice(0, 2).map((t, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Home className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
                <span className="text-zinc-300">{addressPretty(t.value)}</span>
                {t.types.length ? <span className="shrink-0 text-[10px] text-zinc-600">{t.types.join("/")}</span> : null}
              </div>
            ))}
            {card.bday ? (
              <div className="flex items-center gap-1.5">
                <Cake className="h-3 w-3 shrink-0 text-amber-500/70" />
                <span className="text-zinc-300">{card.bday}</span>
              </div>
            ) : null}
            {card.url ? (
              <div className="flex items-center gap-1.5">
                <LinkIcon className="h-3 w-3 shrink-0 text-zinc-500" />
                <span className="truncate text-zinc-300">{card.url}</span>
              </div>
            ) : null}
            {card.note ? (
              <div className="flex items-start gap-1.5">
                <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500" />
                <span className="line-clamp-3 text-zinc-400">{card.note}</span>
              </div>
            ) : null}
          </div>
          {card.version ? <div className="mt-1.5 text-[10px] text-zinc-600">vCard {card.version}</div> : null}
        </div>
      </div>
    </div>
  );
}
