"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ToolButton, ToolbarDivider, ViewerBody, ErrorCard, LoadingState,
  Chip, InfoGrid, Field, SectionCard, EmptyHint,
} from "./viewer-ui";
import { decodeWith, downloadBlob, formatNum } from "@/lib/utils";
import {
  MapPin, TrendingUp, Copy, Download, Check, Route, Mountain, Clock, Gauge, Map as MapIcon,
} from "lucide-react";

/* ============================== data model ============================== */

interface TrackPoint { lat: number; lon: number; ele: number | null; time: number | null; }
interface Segment { name: string | null; points: TrackPoint[]; }
interface Waypoint { name: string; lat: number; lon: number; ele: number | null; desc?: string; }
interface GeoDoc { kind: "GPX" | "KML" | "TCX" | "GeoJSON"; segments: Segment[]; waypoints: Waypoint[]; }
interface FlatPoint extends TrackPoint { dist: number; }

interface GeoStats {
  points: number;
  distance: number;        // meters
  duration: number | null; // ms
  eleMin: number | null;
  eleMax: number | null;
  eleGain: number | null;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
  firstTime: number | null;
  lastTime: number | null;
}

const EARTH_R = 6371000;

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ================================ parsing ================================ */

function localName(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, "");
}
function descendantsByLocal(root: Element | Document, name: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (localName(all[i]) === name) out.push(all[i]);
  }
  return out;
}
function childByLocal(parent: Element, name: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    if (localName(parent.children[i]) === name) return parent.children[i];
  }
  return null;
}
function textOf(el: Element | null): string {
  return (el?.textContent ?? "").trim();
}
function parseNum(s: string): number | null {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

function readGpxPoints(container: Element, tagName: string): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const els = descendantsByLocal(container, tagName);
  for (const el of els) {
    const lat = parseNum(el.getAttribute("lat") ?? "");
    const lon = parseNum(el.getAttribute("lon") ?? "");
    if (lat === null || lon === null) continue;
    const ele = parseNum(textOf(childByLocal(el, "ele")));
    const tRaw = textOf(childByLocal(el, "time"));
    const t = tRaw ? Date.parse(tRaw) : NaN;
    pts.push({ lat, lon, ele, time: Number.isFinite(t) ? t : null });
  }
  return pts;
}

function parseGpx(text: string): GeoDoc {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XML in GPX file");
  const segments: Segment[] = [];
  const waypoints: Waypoint[] = [];
  for (const trk of descendantsByLocal(doc, "trk")) {
    const name = textOf(childByLocal(trk, "name")) || null;
    const segs = descendantsByLocal(trk, "trkseg");
    for (const seg of segs) {
      const pts = readGpxPoints(seg, "trkpt");
      if (pts.length) segments.push({ name, points: pts });
    }
  }
  for (const rte of descendantsByLocal(doc, "rte")) {
    const name = textOf(childByLocal(rte, "name")) || null;
    const pts = readGpxPoints(rte, "rtept");
    if (pts.length) segments.push({ name, points: pts });
  }
  for (const wpt of descendantsByLocal(doc, "wpt")) {
    const lat = parseNum(wpt.getAttribute("lat") ?? "");
    const lon = parseNum(wpt.getAttribute("lon") ?? "");
    if (lat === null || lon === null) continue;
    waypoints.push({
      name: textOf(childByLocal(wpt, "name")) || "waypoint",
      lat, lon,
      ele: parseNum(textOf(childByLocal(wpt, "ele"))),
      desc: textOf(childByLocal(wpt, "desc")) || textOf(childByLocal(wpt, "cmt")) || undefined,
    });
  }
  return { kind: "GPX", segments, waypoints };
}

function parseKmlCoords(s: string): [number, number, number | null][] {
  const out: [number, number, number | null][] = [];
  for (const triplet of s.trim().split(/\s+/)) {
    if (!triplet) continue;
    const parts = triplet.split(",");
    const lon = parseNum(parts[0] ?? "");
    const lat = parseNum(parts[1] ?? "");
    if (lon === null || lat === null) continue;
    const ele = parts.length > 2 ? parseNum(parts[2]) : null;
    out.push([lon, lat, ele]);
  }
  return out;
}

function parseKml(text: string): GeoDoc {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XML in KML file");
  const segments: Segment[] = [];
  const waypoints: Waypoint[] = [];
  for (const pm of descendantsByLocal(doc, "Placemark")) {
    const name = textOf(childByLocal(pm, "name")) || null;
    for (const ls of descendantsByLocal(pm, "LineString")) {
      const coords = parseKmlCoords(textOf(childByLocal(ls, "coordinates")));
      if (coords.length > 1) {
        segments.push({ name, points: coords.map((c) => ({ lat: c[1], lon: c[0], ele: c[2], time: null })) });
      }
    }
    for (const track of descendantsByLocal(pm, "Track")) {
      const pts: TrackPoint[] = [];
      for (const coord of descendantsByLocal(track, "coord")) {
        const parts = textOf(coord).split(/\s+/);
        const lon = parseNum(parts[0] ?? "");
        const lat = parseNum(parts[1] ?? "");
        if (lon === null || lat === null) continue;
        pts.push({ lat, lon, ele: parts.length > 2 ? parseNum(parts[2]) : null, time: null });
      }
      if (pts.length > 1) segments.push({ name, points: pts });
    }
    for (const pt of descendantsByLocal(pm, "Point")) {
      const coords = parseKmlCoords(textOf(childByLocal(pt, "coordinates")));
      if (coords.length) {
        waypoints.push({ name: name || "point", lat: coords[0][1], lon: coords[0][0], ele: coords[0][2] });
      }
    }
  }
  return { kind: "KML", segments, waypoints };
}

function parseTcx(text: string): GeoDoc {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Invalid XML in TCX file");
  const segments: Segment[] = [];
  for (const track of descendantsByLocal(doc, "Track")) {
    const pts: TrackPoint[] = [];
    for (const tp of descendantsByLocal(track, "Trackpoint")) {
      const pos = childByLocal(tp, "Position");
      const lat = pos ? parseNum(textOf(childByLocal(pos, "LatitudeDegrees"))) : null;
      const lon = pos ? parseNum(textOf(childByLocal(pos, "LongitudeDegrees"))) : null;
      if (lat === null || lon === null) continue;
      const tRaw = textOf(childByLocal(tp, "Time"));
      const t = tRaw ? Date.parse(tRaw) : NaN;
      pts.push({
        lat, lon,
        ele: parseNum(textOf(childByLocal(tp, "AltitudeMeters"))),
        time: Number.isFinite(t) ? t : null,
      });
    }
    if (pts.length) segments.push({ name: null, points: pts });
  }
  return { kind: "TCX", segments, waypoints: [] };
}

function parseGeoJson(text: string): GeoDoc {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid GeoJSON — ${e instanceof Error ? e.message : "parse failed"}`);
  }
  const segments: Segment[] = [];
  const waypoints: Waypoint[] = [];
  let segIdx = 0;

  const pushLine = (line: unknown[], name: string | null) => {
    const pts: TrackPoint[] = [];
    for (const c of line) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = typeof c[0] === "number" ? c[0] : null;
      const lat = typeof c[1] === "number" ? c[1] : null;
      if (lon === null || lat === null) continue;
      pts.push({ lat, lon, ele: typeof c[2] === "number" ? c[2] : null, time: null });
    }
    if (pts.length > 1) {
      segIdx++;
      segments.push({ name: name ?? (segments.length ? `route ${segIdx}` : "route"), points: pts });
    }
  };
  const pushPoint = (c: unknown, name: string | null) => {
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return;
    waypoints.push({ name: name || "point", lat: c[1], lon: c[0], ele: typeof c[2] === "number" ? c[2] : null });
  };

  const walk = (node: unknown, name: string | null) => {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.features)) {
      for (const f of n.features) {
        if (f && typeof f === "object") {
          const props = (f as Record<string, unknown>).properties;
          const fname =
            props && typeof props === "object"
              ? String((props as Record<string, unknown>).name ?? (props as Record<string, unknown>).Name ?? "")
              : "";
          walk((f as Record<string, unknown>).geometry, fname || name);
        }
      }
      return;
    }
    if (Array.isArray(n.geometries)) {
      for (const g of n.geometries) walk(g, name);
      return;
    }
    switch (n.type) {
      case "Feature":
        walk(n.geometry, name);
        break;
      case "LineString":
        if (Array.isArray(n.coordinates)) pushLine(n.coordinates, name);
        break;
      case "MultiLineString":
        if (Array.isArray(n.coordinates)) for (const line of n.coordinates) if (Array.isArray(line)) pushLine(line, name);
        break;
      case "Point":
        pushPoint(n.coordinates, name);
        break;
      case "MultiPoint":
        if (Array.isArray(n.coordinates)) for (const p of n.coordinates) pushPoint(p, name);
        break;
      default:
        break;
    }
  };

  walk(obj, null);
  return { kind: "GeoJSON", segments, waypoints };
}

function parseGeoText(text: string): GeoDoc {
  const head = text.slice(0, 400).toLowerCase();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return parseGeoJson(text);
  if (head.includes("<gpx")) return parseGpx(text);
  if (head.includes("<kml")) return parseKml(text);
  if (head.includes("trainingcenterdatabase")) return parseTcx(text);
  throw new Error("No route data found — expected GPX, KML, TCX or GeoJSON content");
}

/* ================================ stats ================================= */

function flatten(doc: GeoDoc): FlatPoint[] {
  const out: FlatPoint[] = [];
  let prev: TrackPoint | null = null;
  let dist = 0;
  for (const seg of doc.segments) {
    for (const p of seg.points) {
      if (prev) dist += haversine(prev.lat, prev.lon, p.lat, p.lon);
      out.push({ ...p, dist });
      prev = p;
    }
  }
  return out;
}

function computeStats(doc: GeoDoc, flat: FlatPoint[]): GeoStats {
  let eleMin: number | null = null;
  let eleMax: number | null = null;
  let eleGain = 0;
  let prevEle: number | null = null;
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;

  for (const p of flat) {
    if (p.ele !== null) {
      if (eleMin === null || p.ele < eleMin) eleMin = p.ele;
      if (eleMax === null || p.ele > eleMax) eleMax = p.ele;
      if (prevEle !== null && p.ele - prevEle > 0) eleGain += p.ele - prevEle;
      prevEle = p.ele;
    }
    if (p.time !== null) {
      if (firstTime === null || p.time < firstTime) firstTime = p.time;
      if (lastTime === null || p.time > lastTime) lastTime = p.time;
    }
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  }
  for (const w of doc.waypoints) {
    minLat = Math.min(minLat, w.lat); maxLat = Math.max(maxLat, w.lat);
    minLon = Math.min(minLon, w.lon); maxLon = Math.max(maxLon, w.lon);
  }
  const distance = flat.length ? flat[flat.length - 1].dist : 0;
  const duration = firstTime !== null && lastTime !== null && lastTime > firstTime ? lastTime - firstTime : null;
  return {
    points: flat.length,
    distance,
    duration,
    eleMin, eleMax,
    eleGain: prevEle !== null ? eleGain : null,
    bounds: flat.length || doc.waypoints.length
      ? { minLat, maxLat, minLon, maxLon }
      : null,
    firstTime, lastTime,
  };
}

/* =============================== formatting =============================== */

function fmtKm(meters: number): string {
  if (meters < 1000) return `${meters.toFixed(0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
function fmtDur(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
function fmtSpeed(distance: number, ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const kmh = (distance / 1000) / (ms / 3600000);
  if (kmh < 10) {
    const pace = ms / 1000 / (distance / 1000); // sec per km
    const pm = Math.floor(pace / 60);
    const ps = Math.round(pace % 60);
    return `${kmh.toFixed(1)} km/h · ${pm}:${String(ps).padStart(2, "0")} /km`;
  }
  return `${kmh.toFixed(1)} km/h`;
}
function fmtDeg(v: number, isLat: boolean): string {
  const hemi = isLat ? (v >= 0 ? "N" : "S") : v >= 0 ? "E" : "W";
  return `${Math.abs(v).toFixed(3)}°${hemi}`;
}

/* ================================ component =============================== */

const MAP_W = 960;
const MAP_H = 470;
const SEGMENT_COLORS = ["#10b981", "#34d399", "#2dd4bf", "#6ee7b7", "#a7f3d0", "#0d9488"];

export default function MapViewer({ arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [doc, setDoc] = React.useState<GeoDoc | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showWaypoints, setShowWaypoints] = React.useState(true);
  const [showElevation, setShowElevation] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  const partial = arrayBuffer === null;

  React.useEffect(() => {
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      if (bytes.length === 0) throw new Error("File is empty");
      setDoc(parseGeoText(decodeWith(bytes, "utf-8")));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  const flat = React.useMemo(() => (doc ? flatten(doc) : []), [doc]);
  const stats = React.useMemo(() => (doc ? computeStats(doc, flat) : null), [doc, flat]);

  const copyCoords = React.useCallback(() => {
    if (!flat.length) return;
    const lines = flat.slice(0, 50000).map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`);
    navigator.clipboard?.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => { /* clipboard unavailable */ });
  }, [flat]);

  const exportGeoJson = React.useCallback(() => {
    if (!doc) return;
    const features: unknown[] = [];
    doc.segments.forEach((seg) => {
      features.push({
        type: "Feature",
        properties: { name: seg.name ?? null, points: seg.points.length },
        geometry: {
          type: "LineString",
          coordinates: seg.points.map((p) => (p.ele !== null ? [p.lon, p.lat, p.ele] : [p.lon, p.lat])),
        },
      });
    });
    for (const w of doc.waypoints) {
      features.push({
        type: "Feature",
        properties: { name: w.name, ele: w.ele, desc: w.desc ?? null },
        geometry: { type: "Point", coordinates: [w.lon, w.lat] },
      });
    }
    const base = fileName.replace(/\.[^.]+$/, "") || "route";
    downloadBlob(JSON.stringify({ type: "FeatureCollection", features }, null, 2), `${base}.geojson`, "application/geo+json");
  }, [doc, fileName]);

  if (error) return <ErrorCard title="Could not parse route file" message={error} hint="Check that this is a valid GPX, KML, TCX or GeoJSON file." />;
  if (!doc || !stats) return <LoadingState label="Parsing route…" />;

  const hasTrack = flat.length > 0;
  const hasEle = flat.filter((p) => p.ele !== null).length >= 2;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">{doc.kind}</Chip>
            {detected.ext ? <Chip tone="zinc">.{detected.ext}</Chip> : null}
            <Chip tone="teal">{formatNum(stats.points)} pts</Chip>
            {doc.waypoints.length ? <Chip tone="zinc">{formatNum(doc.waypoints.length)} waypoints</Chip> : null}
            {doc.segments.length > 1 ? <Chip tone="zinc">{doc.segments.length} segments</Chip> : null}
          </>
        }
        right={
          <>
            <ToolButton label="Waypoints" active={showWaypoints} onClick={() => setShowWaypoints((v) => !v)} title="Toggle waypoint markers">
              <MapPin className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Elevation" active={showElevation} onClick={() => setShowElevation((v) => !v)} title="Toggle elevation profile">
              <TrendingUp className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Copy coords" onClick={copyCoords} disabled={!hasTrack} title="Copy lat,lon list to clipboard">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton label="GeoJSON" onClick={exportGeoJson} disabled={!doc.segments.length && !doc.waypoints.length} title="Export as GeoJSON">
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-5xl space-y-4">
          {partial ? (
            <div className="rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] text-amber-300">
              Large file — only the first 64 KB were loaded, the route may be truncated.
            </div>
          ) : null}

          {!hasTrack && !doc.waypoints.length ? (
            <EmptyHint>No coordinates found in this file.</EmptyHint>
          ) : (
            <>
              <SectionCard
                title="Route chart"
                icon={<Route className="h-3.5 w-3.5" />}
                right={<Chip tone="zinc">equirectangular projection</Chip>}
              >
                <RouteChart doc={doc} showWaypoints={showWaypoints} />
              </SectionCard>

              {showElevation && hasEle ? (
                <SectionCard title="Elevation profile" icon={<Mountain className="h-3.5 w-3.5" />}>
                  <ElevationChart flat={flat} totalDistance={stats.distance} />
                </SectionCard>
              ) : null}

              <SectionCard title="Track statistics" icon={<Gauge className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  <Field label="Points">{formatNum(stats.points)}</Field>
                  <Field label="Distance">{hasTrack ? fmtKm(stats.distance) : "—"}</Field>
                  <Field label="Duration">
                    {stats.duration !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-zinc-500" />
                        {fmtDur(stats.duration)}
                      </span>
                    ) : "—"}
                  </Field>
                  <Field label="Avg speed">{fmtSpeed(stats.distance, stats.duration)}</Field>
                  <Field label="Elevation min">{stats.eleMin !== null ? `${stats.eleMin.toFixed(0)} m` : "—"}</Field>
                  <Field label="Elevation max">{stats.eleMax !== null ? `${stats.eleMax.toFixed(0)} m` : "—"}</Field>
                  <Field label="Elevation gain">
                    {stats.eleGain !== null ? (
                      <span className="text-emerald-300">+{stats.eleGain.toFixed(0)} m</span>
                    ) : "—"}
                  </Field>
                  <Field label="Waypoints">{formatNum(doc.waypoints.length)}</Field>
                  {stats.bounds ? (
                    <>
                      <Field label="Latitude range" mono>
                        {fmtDeg(stats.bounds.minLat, true)} → {fmtDeg(stats.bounds.maxLat, true)}
                      </Field>
                      <Field label="Longitude range" mono>
                        {fmtDeg(stats.bounds.minLon, false)} → {fmtDeg(stats.bounds.maxLon, false)}
                      </Field>
                    </>
                  ) : null}
                  {stats.firstTime ? <Field label="Started">{new Date(stats.firstTime).toLocaleString()}</Field> : null}
                  {stats.lastTime ? <Field label="Ended">{new Date(stats.lastTime).toLocaleString()}</Field> : null}
                </InfoGrid>
              </SectionCard>

              {doc.waypoints.length ? (
                <SectionCard title="Waypoints" icon={<MapPin className="h-3.5 w-3.5" />}>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {doc.waypoints.slice(0, 60).map((w, i) => (
                      <div key={i} className="flex min-w-0 items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-xs">
                        <MapPin className="h-3 w-3 shrink-0 text-teal-400" />
                        <span className="truncate font-medium text-zinc-200" title={w.name}>{w.name}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">
                          {w.ele !== null ? `${w.ele.toFixed(0)}m · ` : ""}{w.lat.toFixed(4)},{w.lon.toFixed(4)}
                        </span>
                      </div>
                    ))}
                    {doc.waypoints.length > 60 ? (
                      <div className="col-span-full text-center text-[11px] text-zinc-500">
                        + {doc.waypoints.length - 60} more waypoints (see map markers)
                      </div>
                    ) : null}
                  </div>
                </SectionCard>
              ) : null}
            </>
          )}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <MapIcon className="h-3.5 w-3.5" />
        <span className="truncate">
          {stats.distance ? fmtKm(stats.distance) : "no distance"} of track · {fileName}
        </span>
      </div>
    </div>
  );
}

/* ============================== route chart ============================== */

function RouteChart({ doc, showWaypoints }: { doc: GeoDoc; showWaypoints: boolean }) {
  const project = React.useMemo(() => buildProjector(doc), [doc]);

  if (!project) return <EmptyHint>No coordinates to draw.</EmptyHint>;
  const { project: pt, bounds } = project;

  const polylines = doc.segments.map((seg, si) => {
    const step = Math.max(1, Math.ceil(seg.points.length / 4000));
    const pts: string[] = [];
    for (let i = 0; i < seg.points.length; i += step) {
      const p = seg.points[i];
      const { x, y } = pt(p.lon, p.lat);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const last = seg.points[seg.points.length - 1];
    if (step > 1 && last) {
      const { x, y } = pt(last.lon, last.lat);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return { points: pts.join(" "), color: SEGMENT_COLORS[si % SEGMENT_COLORS.length], count: seg.points.length, name: seg.name };
  });

  const first = doc.segments[0]?.points[0];
  const lastSeg = doc.segments[doc.segments.length - 1];
  const last = lastSeg?.points[lastSeg.points.length - 1];
  const start = first ? pt(first.lon, first.lat) : null;
  const end = last ? pt(last.lon, last.lat) : null;

  const grid: React.ReactNode[] = [];
  if (bounds) {
    for (let i = 0; i <= 4; i++) {
      const lon = bounds.minLon + ((bounds.maxLon - bounds.minLon) * i) / 4;
      const a = pt(lon, bounds.minLat);
      const b = pt(lon, bounds.maxLat);
      grid.push(
        <g key={`v${i}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#27272a" strokeWidth={1} />
          <text x={a.x} y={MAP_H - 8} textAnchor="middle" fontSize={10} fill="#71717a">{fmtDeg(lon, false)}</text>
        </g>,
      );
    }
    for (let i = 0; i <= 3; i++) {
      const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * i) / 3;
      const a = pt(bounds.minLon, lat);
      const b = pt(bounds.maxLon, lat);
      grid.push(
        <g key={`h${i}`}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#27272a" strokeWidth={1} />
          <text x={6} y={a.y + 3} fontSize={10} fill="#71717a">{fmtDeg(lat, true)}</text>
        </g>,
      );
    }
  }

  const label = (name: string, x: number, y: number) => {
    const lx = Math.min(Math.max(x, 40), MAP_W - 40);
    return (
      <text x={lx} y={y} fontSize={11} fill="#d4d4d8" stroke="#09090b" strokeWidth={3} paintOrder="stroke" className="select-none">
        {name}
      </text>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      className="h-auto w-full rounded-lg border border-zinc-800 bg-zinc-950"
      role="img"
      aria-label="Route map"
    >
      {grid}
      {polylines.map((pl, i) => (
        <g key={i}>
          <polyline points={pl.points} fill="none" stroke={pl.color} strokeWidth={7} strokeOpacity={0.14} strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={pl.points} fill="none" stroke={pl.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {showWaypoints
        ? doc.waypoints.map((w, i) => {
            const { x, y } = pt(w.lon, w.lat);
            if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) return null;
            return (
              <g key={`wp${i}`}>
                <rect x={x - 4.5} y={y - 4.5} width={9} height={9} transform={`rotate(45 ${x} ${y})`} fill="#2dd4bf" stroke="#09090b" strokeWidth={1.5} />
                {w.name ? label(w.name, x + 10, y - 8) : null}
              </g>
            );
          })
        : null}
      {start ? (
        <g>
          <circle cx={start.x} cy={start.y} r={6.5} fill="#34d399" stroke="#09090b" strokeWidth={2} />
          <circle cx={start.x} cy={start.y} r={2} fill="#09090b" />
          {label("START", start.x, start.y - 12)}
        </g>
      ) : null}
      {end ? (
        <g>
          <line x1={end.x} y1={end.y - 12} x2={end.x} y2={end.y + 6} stroke="#fbbf24" strokeWidth={2} />
          <path d={`M ${end.x} ${end.y - 12} l 12 4 l -12 4 z`} fill="#fbbf24" stroke="#09090b" strokeWidth={1} />
          {label("END", end.x - 6, end.y - 18)}
        </g>
      ) : null}
    </svg>
  );
}

function buildProjector(doc: GeoDoc): { project: (lon: number, lat: number) => { x: number; y: number }; bounds: GeoStats["bounds"] } | null {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  let any = false;
  for (const seg of doc.segments) {
    for (const p of seg.points) {
      any = true;
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
  }
  for (const w of doc.waypoints) {
    any = true;
    minLat = Math.min(minLat, w.lat); maxLat = Math.max(maxLat, w.lat);
    minLon = Math.min(minLon, w.lon); maxLon = Math.max(maxLon, w.lon);
  }
  if (!any) return null;

  const PAD = 0.06;
  let latSpan = maxLat - minLat;
  let lonSpan = maxLon - minLon;
  if (latSpan < 1e-7) latSpan = 0.002;
  if (lonSpan < 1e-7) lonSpan = 0.002;
  minLat -= latSpan * PAD; maxLat += latSpan * PAD;
  minLon -= lonSpan * PAD; maxLon += lonSpan * PAD;
  latSpan = maxLat - minLat;
  lonSpan = maxLon - minLon;

  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0.05, Math.cos((midLat * Math.PI) / 180));
  const M = { l: 56, r: 16, t: 16, b: 30 };
  const availW = MAP_W - M.l - M.r;
  const availH = MAP_H - M.t - M.b;
  // equirectangular-ish: pixels per degree of longitude, latitude scaled by 1/cos so km-per-pixel matches
  const pxPerDegLon = Math.min(availW / lonSpan, (availH * cosLat) / latSpan);
  const w = lonSpan * pxPerDegLon;
  const h = (latSpan * pxPerDegLon) / cosLat;
  const ox = M.l + (availW - w) / 2;
  const oy = M.t + (availH - h) / 2;

  return {
    project: (lon: number, lat: number) => ({
      x: ox + (lon - minLon) * pxPerDegLon,
      y: oy + (maxLat - lat) * (pxPerDegLon / cosLat),
    }),
    bounds: { minLat, maxLat, minLon, maxLon },
  };
}

/* ============================ elevation chart ============================ */

const EL_W = 960;
const EL_H = 190;
const EL_M = { l: 52, r: 14, t: 14, b: 26 };

function ElevationChart({ flat, totalDistance }: { flat: FlatPoint[]; totalDistance: number }) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [hover, setHover] = React.useState<{ km: number; ele: number; xFrac: number; yFrac: number } | null>(null);

  const series = React.useMemo(() => {
    const pts: { d: number; e: number }[] = [];
    for (const p of flat) if (p.ele !== null) pts.push({ d: p.dist, e: p.ele });
    if (pts.length < 2) return null;
    const step = Math.max(1, Math.ceil(pts.length / 3000));
    const sampled = step > 1 ? pts.filter((_, i) => i % step === 0 || i === pts.length - 1) : pts;
    let eMin = Infinity, eMax = -Infinity;
    for (const p of sampled) { eMin = Math.min(eMin, p.e); eMax = Math.max(eMax, p.e); }
    if (!Number.isFinite(eMin) || !Number.isFinite(eMax)) return null;
    if (eMax - eMin < 1) { eMin -= 1; eMax += 1; }
    const pad = (eMax - eMin) * 0.08;
    eMin -= pad; eMax += pad;
    const dTotal = Math.max(totalDistance, sampled[sampled.length - 1].d, 1);
    const x = (d: number) => EL_M.l + (d / dTotal) * (EL_W - EL_M.l - EL_M.r);
    const y = (e: number) => EL_H - EL_M.b - ((e - eMin) / (eMax - eMin)) * (EL_H - EL_M.t - EL_M.b);
    return { sampled, eMin, eMax, dTotal, x, y };
  }, [flat, totalDistance]);

  if (!series) return <EmptyHint>Not enough elevation samples to plot a profile.</EmptyHint>;

  const line = series.sampled.map((p, i) => `${i ? "L" : "M"}${series.x(p.d).toFixed(1)} ${series.y(p.e).toFixed(1)}`).join(" ");
  const area = `${line} L${(EL_W - EL_M.r).toFixed(1)} ${EL_H - EL_M.b} L${EL_M.l} ${EL_H - EL_M.b} Z`;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * EL_W;
    const inner = EL_W - EL_M.l - EL_M.r;
    if (px < EL_M.l - 6 || px > EL_W - EL_M.r + 6) { setHover(null); return; }
    const d = ((px - EL_M.l) / inner) * series.dTotal;
    // nearest sample (series is sorted by d)
    let lo = 0, hi = series.sampled.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series.sampled[mid].d < d) lo = mid + 1;
      else hi = mid;
    }
    const p = series.sampled[lo];
    const sx = series.x(p.d);
    const sy = series.y(p.e);
    setHover({ km: p.d / 1000, ele: p.e, xFrac: sx / EL_W, yFrac: sy / EL_H });
  };

  const eleTicks = [0, 0.5, 1].map((f) => series.eMin + (series.eMax - series.eMin) * f);
  const kmTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => series.dTotal * f);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${EL_W} ${EL_H}`}
        className="h-auto w-full rounded-lg border border-zinc-800 bg-zinc-950"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Elevation profile"
      >
        <defs>
          <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {eleTicks.map((e, i) => {
          const y = series.y(e);
          return (
            <g key={`et${i}`}>
              <line x1={EL_M.l} y1={y} x2={EL_W - EL_M.r} y2={y} stroke="#27272a" strokeWidth={1} />
              <text x={EL_M.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#71717a">{e.toFixed(0)} m</text>
            </g>
          );
        })}
        {kmTicks.map((d, i) => {
          const x = series.x(d);
          return (
            <g key={`kt${i}`}>
              <line x1={x} y1={EL_M.t} x2={x} y2={EL_H - EL_M.b} stroke="#27272a" strokeWidth={1} />
              <text x={x} y={EL_H - 8} textAnchor="middle" fontSize={10} fill="#71717a">
                {d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`}
              </text>
            </g>
          );
        })}
        <path d={area} fill="url(#eleFill)" stroke="none" />
        <path d={line} fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round" />
        {hover ? (
          <g>
            <line
              x1={hover.xFrac * EL_W} y1={EL_M.t}
              x2={hover.xFrac * EL_W} y2={EL_H - EL_M.b}
              stroke="#fbbf24" strokeWidth={1} strokeDasharray="4 3"
            />
            <circle cx={hover.xFrac * EL_W} cy={hover.yFrac * EL_H} r={4} fill="#fbbf24" stroke="#09090b" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[130%] whitespace-nowrap rounded border border-zinc-700 bg-zinc-900/95 px-2 py-1 font-mono text-[11px] text-zinc-200 shadow"
          style={{ left: `${hover.xFrac * 100}%`, top: `${hover.yFrac * 100}%` }}
        >
          <span className="text-amber-300">{hover.km.toFixed(2)} km</span>
          <span className="mx-1 text-zinc-600">·</span>
          <span className="text-emerald-300">{hover.ele.toFixed(0)} m</span>
        </div>
      ) : null}
    </div>
  );
}
