"use client";

import * as React from "react";
import * as THREE from "three";
import type { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ErrorCard, LoadingState, Chip } from "./viewer-ui";
import { formatNum, decodeWith, downloadBlob, clamp } from "@/lib/utils";
import { Camera, Eye, EyeOff, Gauge, Layers, Maximize, Printer, RotateCw, Route, Thermometer } from "lucide-react";

/* ------------------------------ g-code parser ------------------------------ */

const MAX_SEGMENTS = 400_000;
const FILAMENT_DIAMETER = 1.75; // mm — assumption for volume estimate

export interface GcodeLineSet {
  pos: Float32Array; // x1,y1,z1,x2,y2,z2 (g-code coords) per segment
  layer: Int32Array;
  count: number;
  monotonic: boolean;
}

export interface GcodeData {
  extrude: GcodeLineSet;
  travel: GcodeLineSet;
  layers: number;
  moves: number;
  extrudeDistance: number; // mm
  travelDistance: number; // mm
  filamentLength: number; // mm of filament (positive E deltas)
  feedSeen: boolean;
  simTimeSec: number | null;
  commentTimeSec: number | null;
  toolTempMax: number | null;
  bedTempMax: number | null;
  truncated: boolean;
  hasExtrusion: boolean;
}

function parseTimeWords(s: string): number | null {
  let sec = 0;
  let found = false;
  const grab = (re: RegExp): void => {
    const m = re.exec(s);
    if (m) {
      sec += parseFloat(m[1]);
      found = true;
    }
  };
  grab(/(\d+(?:\.\d+)?)\s*d(?:ay)?s?\b/i);
  grab(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/i);
  grab(/(\d+(?:\.\d+)?)\s*m(?:in|ins|inutes?)?\b/i);
  grab(/(\d+(?:\.\d+)?)\s*s(?:ec|ecs|econds?)?\b/i);
  return found ? sec : null;
}

export function parseGcodeText(text: string): GcodeData {
  const lines = text.split(/\r\n|\r|\n/);
  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let absXYZ = true;
  let absE = true;
  let layer = 0;
  let curLayerZ = -Infinity;
  let markerMode = false;
  let feed = 0;
  let feedSeen = false;
  let simTime = 0;
  let moves = 0;
  let extrudeDistance = 0;
  let travelDistance = 0;
  let filamentLength = 0;
  let commentTimeSec: number | null = null;
  let toolTempMax: number | null = null;
  let bedTempMax: number | null = null;
  let truncated = false;

  const exPos: number[] = [];
  const exLayer: number[] = [];
  const trPos: number[] = [];
  const trLayer: number[] = [];

  const wordRe = /([A-Za-z])([-+]?\d*\.?\d+)/g;

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const semi = raw.indexOf(";");
    const code = (semi >= 0 ? raw.slice(0, semi) : raw).trim();
    const comment = semi >= 0 ? raw.slice(semi + 1).trim() : "";

    if (comment) {
      const lm = /^LAYER:\s*(-?\d+)/i.exec(comment);
      if (lm) {
        markerMode = true;
        layer = Math.max(0, parseInt(lm[1], 10)) + 1;
      }
      const tm = /^TIME:\s*(\d+(?:\.\d+)?)/i.exec(comment);
      if (tm) commentTimeSec = parseFloat(tm[1]);
      const et = /estimated printing time[^=]*=\s*([^=\r\n]+)/i.exec(comment);
      if (et) {
        const t = parseTimeWords(et[1]);
        if (t !== null) commentTimeSec = t;
      }
    }
    if (!code) continue;

    let g = NaN;
    let m = NaN;
    const params: Record<string, number> = {};
    let match: RegExpExecArray | null;
    wordRe.lastIndex = 0;
    while ((match = wordRe.exec(code)) !== null) {
      const letter = match[1].toUpperCase();
      const value = parseFloat(match[2]);
      if (letter === "G" && Number.isNaN(g)) g = value;
      else if (letter === "M" && Number.isNaN(m)) m = value;
      else params[letter] = value;
    }

    if (!Number.isNaN(g)) {
      const gi = Math.round(g);
      if (gi === 0 || gi === 1) {
        const nx = params.X !== undefined ? (absXYZ ? params.X : x + params.X) : x;
        const ny = params.Y !== undefined ? (absXYZ ? params.Y : y + params.Y) : y;
        const nz = params.Z !== undefined ? (absXYZ ? params.Z : z + params.Z) : z;
        let ne = e;
        if (params.E !== undefined) ne = absE ? params.E : e + params.E;
        const de = ne - e;
        if (params.F !== undefined && params.F > 0) {
          feed = params.F;
          feedSeen = true;
        }
        const dist = Math.hypot(nx - x, ny - y, nz - z);
        const extruding = de > 1e-9;
        if (dist > 1e-9) {
          moves++;
          if (!markerMode && extruding && nz > curLayerZ + 1e-6) {
            layer++;
            curLayerZ = nz;
          } else if (markerMode && extruding) {
            curLayerZ = nz;
          }
          if (extruding) extrudeDistance += dist;
          else travelDistance += dist;
          if (feedSeen && feed > 0) simTime += dist / (feed / 60);
          if (exPos.length / 6 + trPos.length / 6 < MAX_SEGMENTS) {
            if (extruding) {
              exPos.push(x, y, z, nx, ny, nz);
              exLayer.push(layer);
            } else {
              trPos.push(x, y, z, nx, ny, nz);
              trLayer.push(layer);
            }
          } else {
            truncated = true;
          }
          x = nx;
          y = ny;
          z = nz;
          e = ne;
        } else if (Math.abs(de) > 1e-9) {
          if (de > 0) filamentLength += de;
          e = ne;
        }
      } else if (gi === 90) {
        absXYZ = true;
      } else if (gi === 91) {
        absXYZ = false;
      } else if (gi === 92) {
        if (params.X !== undefined) x = params.X;
        if (params.Y !== undefined) y = params.Y;
        if (params.Z !== undefined) z = params.Z;
        if (params.E !== undefined) e = params.E;
      }
    } else if (!Number.isNaN(m)) {
      const mi = Math.round(m);
      if ((mi === 104 || mi === 109) && params.S !== undefined && params.S > 0) {
        toolTempMax = Math.max(toolTempMax ?? 0, params.S);
      }
      if ((mi === 140 || mi === 190) && params.S !== undefined && params.S > 0) {
        bedTempMax = Math.max(bedTempMax ?? 0, params.S);
      }
      if (mi === 82) absE = true;
      if (mi === 83) absE = false;
    }
  }

  const finish = (pos: number[], lay: number[]): GcodeLineSet => {
    const count = lay.length;
    let monotonic = true;
    for (let i = 1; i < count; i++) {
      if (lay[i] < lay[i - 1]) {
        monotonic = false;
        break;
      }
    }
    return {
      pos: new Float32Array(pos),
      layer: new Int32Array(lay),
      count,
      monotonic,
    };
  };

  return {
    extrude: finish(exPos, exLayer),
    travel: finish(trPos, trLayer),
    layers: layer,
    moves,
    extrudeDistance,
    travelDistance,
    filamentLength,
    feedSeen,
    simTimeSec: feedSeen && simTime > 1 ? simTime : null,
    commentTimeSec,
    toolTempMax,
    bedTempMax,
    truncated,
    hasExtrusion: exLayer.length > 0,
  };
}

function formatSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/* ------------------------------ three helpers ------------------------------ */

interface LineObj {
  geometry: any;
  object: any;
  set: GcodeLineSet;
  fullAttribute: any;
  filtered: Float32Array | null;
  filteredAttribute: any;
  lastN: number;
}

function buildLineSet(set: GcodeLineSet, material: any): LineObj | null {
  if (set.count === 0) return null;
  const mapped = new Float32Array(set.count * 6);
  for (let i = 0; i < set.count; i++) {
    // g-code (x, y, z) → three (x, z, y) so the print bed lies in X/Z and height is Y
    mapped[i * 6] = set.pos[i * 6];
    mapped[i * 6 + 1] = set.pos[i * 6 + 2];
    mapped[i * 6 + 2] = set.pos[i * 6 + 1];
    mapped[i * 6 + 3] = set.pos[i * 6 + 3];
    mapped[i * 6 + 4] = set.pos[i * 6 + 5];
    mapped[i * 6 + 5] = set.pos[i * 6 + 4];
  }
  const geometry = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(mapped, 3);
  geometry.setAttribute("position", attr);
  const object = new THREE.LineSegments(geometry, material);
  return { geometry, object, set, fullAttribute: attr, filtered: null, filteredAttribute: null, lastN: -1 };
}

/** Show only segments on layers ≤ n. Fast drawRange path for monotonic data. */
function applyLayerFilter(lo: LineObj | null, n: number, layers: number) {
  if (!lo) return;
  const { set, geometry, fullAttribute } = lo;
  if (n >= layers) {
    if (lo.filteredAttribute) geometry.setAttribute("position", fullAttribute);
    geometry.setDrawRange(0, Infinity);
    lo.lastN = n;
    return;
  }
  if (set.monotonic) {
    if (lo.filteredAttribute) geometry.setAttribute("position", fullAttribute);
    // binary search first index with layer > n
    let loIdx = 0;
    let hiIdx = set.count;
    while (loIdx < hiIdx) {
      const mid = (loIdx + hiIdx) >> 1;
      if (set.layer[mid] <= n) loIdx = mid + 1;
      else hiIdx = mid;
    }
    geometry.setDrawRange(0, loIdx * 2);
    lo.lastN = n;
    return;
  }
  // non-monotonic fallback: compact visible segments into a scratch buffer
  if (!lo.filtered || lo.filtered.length < set.count * 6) lo.filtered = new Float32Array(set.count * 6);
  const out = lo.filtered;
  let write = 0;
  for (let i = 0; i < set.count; i++) {
    if (set.layer[i] > n) continue;
    const src = i * 6;
    const dst = write * 6;
    out[dst] = set.pos[src];
    out[dst + 1] = set.pos[src + 2];
    out[dst + 2] = set.pos[src + 1];
    out[dst + 3] = set.pos[src + 3];
    out[dst + 4] = set.pos[src + 5];
    out[dst + 5] = set.pos[src + 4];
    write++;
  }
  if (!lo.filteredAttribute) {
    lo.filteredAttribute = new THREE.BufferAttribute(out, 3);
  }
  geometry.setAttribute("position", lo.filteredAttribute);
  lo.filteredAttribute.needsUpdate = true;
  geometry.setDrawRange(0, write * 2);
  lo.lastN = n;
}

/* ------------------------------ component ------------------------------ */

const GCODE_CAP = 8 * 1024 * 1024;

export default function GcodeViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const apiRef = React.useRef<{ renderer: any; scene: any; camera: any; controls: any; grid: any; extrude: LineObj | null; travel: LineObj | null } | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [data, setData] = React.useState<GcodeData | null>(null);
  const [showTravel, setShowTravel] = React.useState(true);
  const [autoRotate, setAutoRotate] = React.useState(false);
  const [layerN, setLayerN] = React.useState<number | null>(null);
  const showTravelRef = React.useRef(true);
  const autoRotateRef = React.useRef(false);

  React.useEffect(() => {
    showTravelRef.current = showTravel;
    const api = apiRef.current;
    if (api?.travel) api.travel.object.visible = showTravel;
  }, [showTravel]);

  React.useEffect(() => {
    autoRotateRef.current = autoRotate;
    const api = apiRef.current;
    if (api?.controls) {
      api.controls.autoRotate = autoRotate;
      api.controls.autoRotateSpeed = 1.6;
    }
  }, [autoRotate]);

  React.useEffect(() => {
    const api = apiRef.current;
    if (!api || !data || layerN === null) return;
    applyLayerFilter(api.extrude, layerN, data.layers);
    applyLayerFilter(api.travel, layerN, data.layers);
  }, [layerN, data, phase]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!arrayBuffer) {
      setPhase("error");
      setErrorMsg("This file exceeds the in-browser load cap (96 MB). G-code rendering needs the full buffer — try splitting the file.");
      return;
    }
    if (file.size > GCODE_CAP) {
      setPhase("error");
      setErrorMsg(`G-code files are capped at 8 MB in this viewer (this one is ${(file.size / 1048576).toFixed(1)} MB).`);
      return;
    }

    let disposed = false;
    let renderer: any = null;
    let controls: any = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let extrudeObj: LineObj | null = null;
    let travelObj: LineObj | null = null;

    setPhase("loading");
    setErrorMsg(null);
    setData(null);
    setLayerN(null);

    (async () => {
      try {
        const bytes = new Uint8Array(arrayBuffer);
        const text = decodeWith(bytes, "utf-8");
        if (!text.trim()) throw new Error("File contains no G-code text.");
        // let the loading state paint before the (potentially long) parse
        await new Promise((r) => setTimeout(r, 16));
        if (disposed) return;

        const gcode = parseGcodeText(text);
        if (gcode.extrude.count === 0 && gcode.travel.count === 0) {
          throw new Error("No G0/G1 motion commands found — is this really a toolpath?");
        }
        if (disposed) return;

        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        } catch {
          throw new Error("WebGL context could not be created — the GPU may be disabled or unsupported in this browser.");
        }
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 600, false);
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x09090b);
        const camera = new THREE.PerspectiveCamera(50, (mount.clientWidth || 800) / Math.max(1, mount.clientHeight || 600), 0.01, 5000);

        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (disposed) return;
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = autoRotateRef.current;
        controls.autoRotateSpeed = 1.6;
        scene.add(new THREE.HemisphereLight(0xd4d4d8, 0x1c1c1f, 1.1));

        const group = new THREE.Group();
        extrudeObj = buildLineSet(
          gcode.extrude,
          new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 }),
        );
        travelObj = buildLineSet(
          gcode.travel,
          new THREE.LineBasicMaterial({ color: 0x52525b, transparent: true, opacity: 0.28 }),
        );
        if (extrudeObj) group.add(extrudeObj.object);
        if (travelObj) {
          travelObj.object.visible = showTravelRef.current;
          group.add(travelObj.object);
        }
        scene.add(group);

        const box = new THREE.Box3().setFromObject(group);
        if (!box || !isFinite(box.min.x) || (box.isEmpty && box.isEmpty())) {
          throw new Error("Toolpath has no measurable extent.");
        }
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1e-3);
        const size = new THREE.Vector3();
        box.getSize(size);
        group.position.sub(sphere.center);

        const grid = new THREE.GridHelper(radius * 3.6, 24, 0x3f3f46, 0x1f1f23);
        grid.position.y = -size.y / 2 - radius * 0.002;
        scene.add(grid);

        const fitDist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.18;
        const dir = new THREE.Vector3(0.9, 0.75, 1).normalize();
        camera.position.copy(dir).multiplyScalar(fitDist);
        camera.near = Math.max(radius / 400, 0.001);
        camera.far = Math.max(fitDist * 40, 10);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        controls.saveState();

        ro = new ResizeObserver(() => {
          const w = mount.clientWidth;
          const h = mount.clientHeight;
          if (!w || !h || !renderer) return;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        ro.observe(mount);

        apiRef.current = { renderer, scene, camera, controls, grid, extrude: extrudeObj, travel: travelObj };

        const tick = () => {
          if (disposed) return;
          raf = requestAnimationFrame(tick);
          if (controls) controls.update();
          renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(tick);

        setData(gcode);
        setLayerN(gcode.layers);
        setPhase("ready");
      } catch (err) {
        if (disposed) return;
        if (controls) {
          try {
            controls.dispose();
          } catch {
            /* ignore */
          }
        }
        if (renderer) {
          try {
            renderer.dispose();
          } catch {
            /* ignore */
          }
        }
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (controls) {
        try {
          controls.dispose();
        } catch {
          /* ignore */
        }
      }
      if (renderer) {
        try {
          renderer.dispose();
        } catch {
          /* ignore */
        }
        try {
          renderer.forceContextLoss?.();
        } catch {
          /* ignore */
        }
      }
      for (const lo of [extrudeObj, travelObj]) {
        try {
          lo?.geometry.dispose();
          lo?.object.material.dispose();
        } catch {
          /* ignore */
        }
      }
      if (mount) while (mount.firstChild) mount.removeChild(mount.firstChild);
      apiRef.current = null;
    };
  }, [arrayBuffer, fileName]);

  const resetView = React.useCallback(() => {
    const api = apiRef.current;
    if (!api?.controls) return;
    api.controls.reset();
    api.controls.update();
  }, []);

  const screenshot = React.useCallback(async () => {
    const api = apiRef.current;
    if (!api?.renderer) return;
    try {
      api.renderer.render(api.scene, api.camera);
      const url = api.renderer.domElement.toDataURL("image/png");
      const blob = await (await fetch(url)).blob();
      const base = fileName.replace(/\.[^.]+$/, "") || "gcode";
      downloadBlob(blob, `${base}-omniscope.png`, "image/png");
    } catch {
      /* ignore capture failure */
    }
  }, [fileName]);

  const volumeCm3 = data ? (data.filamentLength * Math.PI * (FILAMENT_DIAMETER / 2) ** 2) / 1000 : 0;
  const timeSec = data ? (data.commentTimeSec ?? data.simTimeSec) : null;
  const layers = data?.layers ?? 0;
  const currentLayer = layerN ?? layers;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">
              <Route className="h-3 w-3" />
              G-code
            </Chip>
            {data ? (
              <>
                <Chip>
                  <Layers className="h-3 w-3" />
                  {formatNum(layers)} layers
                </Chip>
                <Chip>{formatNum(data.moves)} moves</Chip>
                <Chip>{(data.extrudeDistance / 1000).toFixed(2)} m extrusion</Chip>
                <Chip>{(data.filamentLength / 1000).toFixed(2)} m filament</Chip>
                <Chip>≈{volumeCm3.toFixed(1)} cm³ @1.75mm</Chip>
                {timeSec !== null ? (
                  <Chip tone="amber">
                    <Gauge className="h-3 w-3" />
                    ~{formatSeconds(timeSec)}
                  </Chip>
                ) : null}
                {data.toolTempMax !== null ? (
                  <Chip tone="rose">
                    <Thermometer className="h-3 w-3" />
                    {Math.round(data.toolTempMax)}°C tool
                  </Chip>
                ) : null}
                {data.bedTempMax !== null ? (
                  <Chip tone="amber">{Math.round(data.bedTempMax)}°C bed</Chip>
                ) : null}
              </>
            ) : null}
          </>
        }
        center={
          layers > 1 ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <Printer className="h-3.5 w-3.5 text-zinc-500" />
              <span className="hidden shrink-0 sm:inline">Layer</span>
              <input
                type="range"
                min={1}
                max={layers}
                value={clamp(currentLayer, 1, layers)}
                onChange={(ev) => setLayerN(Number(ev.target.value))}
                className="h-1.5 w-28 cursor-pointer accent-emerald-500 md:w-44"
                aria-label="Layer filter"
              />
              <span className="w-16 shrink-0 tabular-nums text-zinc-300">
                {currentLayer}/{layers}
              </span>
            </div>
          ) : undefined
        }
        right={
          <>
            <ToolButton label="Travel" title="Toggle travel moves" active={showTravel} onClick={() => setShowTravel((v) => !v)}>
              {showTravel ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton label="Spin" title="Toggle auto-rotate" active={autoRotate} onClick={() => setAutoRotate((v) => !v)}>
              <RotateCw className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolbarDivider />
            <ToolButton label="Reset" title="Reset view" onClick={resetView}>
              <Maximize className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Shot" title="Save PNG screenshot" onClick={() => void screenshot()}>
              <Camera className="h-3.5 w-3.5" />
            </ToolButton>
          </>
        }
      />
      <div className="relative min-h-0 flex-1 bg-[#09090b]">
        {phase === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#09090b]/60">
            <LoadingState label="Parsing toolpath…" />
          </div>
        ) : null}
        {phase === "error" ? (
          <ErrorCard
            title="G-code render failed"
            message={errorMsg ?? "Unknown error"}
            hint="Supports FFF slicing G-code (G0/G1 moves, E extrusion, ;LAYER markers) — drag to orbit, scroll to zoom."
          />
        ) : (
          <div ref={mountRef} className="absolute inset-0" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Route className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Emerald = extrusion · gray = travel
          {data?.truncated ? " · path truncated at 400k segments" : ""}
          {data && !data.hasExtrusion ? " · no extrusion detected (CNC-style path)" : ""}
        </span>
        <span className="ml-auto hidden shrink-0 text-zinc-600 sm:inline">{fileName}</span>
      </div>
    </div>
  );
}
