"use client";

import * as React from "react";
import * as THREE from "three";
import type { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ErrorCard, LoadingState, Chip } from "./viewer-ui";
import { formatNum, decodeWith, downloadBlob } from "@/lib/utils";
import { Atom, Box, Camera, Grid3x3, Layers, Maximize, Ruler, RotateCw } from "lucide-react";

/* ------------------------------ model kinds ------------------------------ */

type Kind = "glb" | "gltf" | "obj" | "stl" | "ply" | "dae" | "3mf" | "pdb";

interface PdbInfo {
  atoms: number;
  bonds: number;
  residues: number;
  title: string;
}

interface ModelStats {
  vertices: number;
  faces: number;
  meshes: number;
  materials: number;
  dims: [number, number, number];
  pdb?: PdbInfo;
}

/** Chemistry-ish element colors — deliberately no pure blue/indigo. */
const ELEMENT_COLORS: Record<string, string> = {
  h: "#d4d4d8", c: "#a1a1aa", n: "#14b8a6", o: "#f43f5e", s: "#f59e0b",
  p: "#fb923c", f: "#4ade80", cl: "#34d399", br: "#f87171", i: "#c084fc",
  fe: "#ea580c", ca: "#fbbf24", na: "#facc15", mg: "#a3e635", zn: "#a8a29e",
  cu: "#fb7185", k: "#86efac", mn: "#f97316", se: "#fde047", b: "#d6d3d1",
  si: "#e7e5e4", li: "#c084fc",
};
const ELEMENT_DEFAULT = "#c084fc";

function elementColor(el: string): string {
  return ELEMENT_COLORS[el.toLowerCase()] ?? ELEMENT_DEFAULT;
}

/* ------------------------------ detection ------------------------------ */

function looksLikeObj(text: string): boolean {
  const lines = text.split("\n", 80);
  let hits = 0;
  for (const l of lines) {
    if (/^(v|vt|vn|f|o|s|usemtl|mtllib)\s/.test(l)) hits++;
  }
  return hits >= 3;
}

function detectKind(fileName: string, extHint: string | undefined, head: Uint8Array): Kind | null {
  const ext = (extHint || fileName.split(".").pop() || "").toLowerCase();
  const headText = decodeWith(head.subarray(0, 2048), "utf-8").trim();
  const isGlbMagic = head.length >= 8 && head[4] === 0x67 && head[5] === 0x6c && head[6] === 0x54 && head[7] === 0x46;
  const isZip = head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b;
  const isPly = headText.startsWith("ply");
  const isStlAscii = headText.startsWith("solid") && /facet\s+normal/.test(headText);
  const isCollada = /<collada/i.test(headText);
  const isPdbText = headText.startsWith("HEADER") || /^ATOM {1,2}/m.test(headText);
  const looksObj = looksLikeObj(headText);

  if (ext === "glb" || isGlbMagic) return "glb";
  if (ext === "gltf" || (headText.startsWith("{") && headText.includes("\"asset\""))) return "gltf";
  if (ext === "3mf" || (ext === "model" && isZip)) return "3mf";
  if (ext === "pdb" || ext === "ent" || (!isPly && !isStlAscii && !looksObj && isPdbText)) return "pdb";
  if (ext === "stl" || isStlAscii) return "stl";
  if (ext === "ply" || isPly) return "ply";
  if (ext === "dae" || isCollada) return "dae";
  if (ext === "obj" || looksObj) return "obj";
  return null;
}

/* ------------------------------ helpers ------------------------------ */

function disposeObject(root: any) {
  if (!root) return;
  try {
    root.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      for (const m of mats) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose?.();
        }
        m.dispose?.();
      }
    });
  } catch {
    /* best effort */
  }
}

function collectMaterials(root: any): any[] {
  const out: any[] = [];
  if (!root) return out;
  try {
    root.traverse((obj: any) => {
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (m && !out.includes(m)) out.push(m);
      }
    });
  } catch {
    /* ignore */
  }
  return out;
}

function emeraldMaterial(vertexColors: boolean): any {
  return new THREE.MeshStandardMaterial({
    color: 0x34d399,
    metalness: 0.12,
    roughness: 0.48,
    vertexColors,
  });
}

/** Count atoms/residues/title directly from the PDB text. */
function pdbTextStats(text: string): { residues: number; title: string } {
  const residues = new Set<string>();
  const titleParts: string[] = [];
  for (const line of text.split("\n", 200000)) {
    if (line.startsWith("ATOM  ") || line.startsWith("HETATM")) {
      residues.add(line.slice(21, 27));
    } else if (/^TITLE\s/.test(line)) {
      titleParts.push(line.slice(10).replace(/^\d+\s*/, "").trim());
    } else if (/^HEADER\s/.test(line) && titleParts.length === 0) {
      const classification = line.slice(10, 50).trim();
      if (classification) titleParts.push(classification);
    }
  }
  return { residues: residues.size, title: titleParts.join(" ").trim() };
}

async function loadModel(kind: Kind, bytes: Uint8Array): Promise<{ object: any; pdb?: PdbInfo }> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  if (kind === "glb" || kind === "gltf") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const data = kind === "glb" ? buffer : decodeWith(bytes, "utf-8");
    const gltf = await new Promise<any>((resolve, reject) => {
      try {
        new GLTFLoader().parse(data, "", (result: any) => resolve(result), (err: unknown) => reject(err));
      } catch (err) {
        reject(err);
      }
    });
    if (!gltf?.scene) throw new Error("glTF file contains no scene graph.");
    return { object: gltf.scene };
  }

  if (kind === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    const obj = new OBJLoader().parse(decodeWith(bytes, "utf-8"));
    const mat = emeraldMaterial(false);
    obj.traverse((o: any) => {
      if (o.isMesh) o.material = mat;
    });
    return { object: obj };
  }

  if (kind === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const geometry = new STLLoader().parse(buffer);
    if (!geometry?.attributes?.position?.count) throw new Error("STL contains no triangles.");
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    return { object: new THREE.Mesh(geometry, emeraldMaterial(false)) };
  }

  if (kind === "ply") {
    const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
    const geometry = new PLYLoader().parse(buffer);
    if (!geometry?.attributes?.position?.count) throw new Error("PLY contains no vertices.");
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const header = decodeWith(bytes.subarray(0, 2048), "utf-8");
    const faceCount = /element\s+face\s+(\d+)/i.exec(header);
    const hasFaces = !!geometry.index || (faceCount && parseInt(faceCount[1]) > 0);
    if (hasFaces) {
      return { object: new THREE.Mesh(geometry, emeraldMaterial(!!geometry.attributes.color)) };
    }
    // point-cloud PLY (no faces) → render as points
    return {
      object: new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: 0x34d399,
          size: 0.02,
          sizeAttenuation: true,
          vertexColors: !!geometry.attributes.color,
        }),
      ),
    };
  }

  if (kind === "dae") {
    const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
    const collada = new ColladaLoader().parse(decodeWith(bytes, "utf-8"), "");
    if (!collada?.scene) throw new Error("COLLADA file contains no scene.");
    const fallback = emeraldMaterial(false);
    collada.scene.traverse((o: any) => {
      if (o.isMesh && (!o.material || (Array.isArray(o.material) && !o.material.length))) o.material = fallback;
    });
    return { object: collada.scene };
  }

  if (kind === "3mf") {
    const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
    const group = new ThreeMFLoader().parse(buffer);
    if (!group) throw new Error("3MF archive could not be parsed.");
    const fallback = emeraldMaterial(false);
    group.traverse((o: any) => {
      if (o.isMesh && (!o.material || (Array.isArray(o.material) && !o.material.length))) o.material = fallback;
    });
    return { object: group };
  }

  // PDB → atoms as Points + bonds as LineSegments
  const { PDBLoader } = await import("three/examples/jsm/loaders/PDBLoader.js");
  const text = decodeWith(bytes, "utf-8");
  const protein = new PDBLoader().parse(text);
  if (!protein?.geometryAtoms?.attributes?.position?.count) throw new Error("PDB file contains no ATOM records.");
  const atoms: any[] = protein.json?.atoms ?? [];
  const position = protein.geometryAtoms.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const el = String(atoms[i]?.[4] ?? "c");
    color.set(elementColor(el));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  protein.geometryAtoms.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const group = new THREE.Group();
  group.add(
    new THREE.Points(
      protein.geometryAtoms,
      new THREE.PointsMaterial({ size: 0.8, sizeAttenuation: true, vertexColors: true }),
    ),
  );
  const bondCount = protein.geometryBonds?.attributes?.position?.count
    ? Math.floor(protein.geometryBonds.attributes.position.count / 2)
    : 0;
  if (bondCount > 0) {
    group.add(
      new THREE.LineSegments(
        protein.geometryBonds,
        new THREE.LineBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.55 }),
      ),
    );
  }
  const { residues, title } = pdbTextStats(decodeWith(bytes.subarray(0, Math.min(bytes.length, 262144)), "utf-8"));
  return {
    object: group,
    pdb: { atoms: position.count, bonds: bondCount, residues, title },
  };
}

function computeStats(object: any, dims: [number, number, number], pdb?: PdbInfo): ModelStats {
  let vertices = 0;
  let faces = 0;
  let meshes = 0;
  try {
    object.traverse((o: any) => {
      if ((o.isMesh || o.isPoints || o.isLineSegments || o.isLine) && o.geometry?.attributes?.position) {
        if (o.isMesh) meshes++;
        const pos = o.geometry.attributes.position;
        vertices += pos.count;
        if (o.isMesh && !o.isPoints) {
          faces += o.geometry.index ? o.geometry.index.count / 3 : pos.count / 3;
        }
      }
    });
  } catch {
    /* ignore */
  }
  return {
    vertices: Math.floor(vertices),
    faces: Math.floor(faces),
    meshes,
    materials: collectMaterials(object).length,
    dims,
    pdb,
  };
}

/* ------------------------------ scene api ------------------------------ */

interface SceneApi {
  renderer: any;
  scene: any;
  camera: any;
  controls: any;
  grid: any;
  object: any;
  materials: any[];
}

/* ------------------------------ component ------------------------------ */

export default function ThreeViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const apiRef = React.useRef<SceneApi | null>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [kind, setKind] = React.useState<Kind | null>(null);
  const [stats, setStats] = React.useState<ModelStats | null>(null);

  const [wireframe, setWireframe] = React.useState(false);
  const [autoRotate, setAutoRotate] = React.useState(false);
  const [gridOn, setGridOn] = React.useState(true);
  const wireframeRef = React.useRef(false);
  const autoRotateRef = React.useRef(false);
  const gridOnRef = React.useRef(true);

  React.useEffect(() => {
    wireframeRef.current = wireframe;
    const api = apiRef.current;
    if (api) for (const m of api.materials) if (m && "wireframe" in m) m.wireframe = wireframe;
  }, [wireframe]);

  React.useEffect(() => {
    autoRotateRef.current = autoRotate;
    const api = apiRef.current;
    if (api?.controls) {
      api.controls.autoRotate = autoRotate;
      api.controls.autoRotateSpeed = 1.6;
    }
  }, [autoRotate]);

  React.useEffect(() => {
    gridOnRef.current = gridOn;
    const api = apiRef.current;
    if (api?.grid) api.grid.visible = gridOn;
  }, [gridOn]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!arrayBuffer) {
      setPhase("error");
      setErrorMsg("This file exceeds the in-browser load cap (96 MB). 3D rendering needs the full buffer — try extracting or splitting first.");
      return;
    }

    let disposed = false;
    let renderer: any = null;
    let controls: any = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let object: any = null;

    setPhase("loading");
    setErrorMsg(null);
    setStats(null);
    setKind(null);

    (async () => {
      try {
        const bytes = new Uint8Array(arrayBuffer);
        const k = detectKind(fileName, detected.ext, head);
        if (!k) {
          throw new Error("Content is not a recognized 3D format (glb / gltf / obj / stl / ply / dae / 3mf / pdb).");
        }
        if (disposed) return;
        setKind(k);

        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
        } catch {
          throw new Error("WebGL context could not be created — the GPU may be disabled or unsupported in this browser.");
        }
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(mount.clientWidth || 800, mount.clientHeight || 600, false);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.style.display = "block";
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.touchAction = "none";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x09090b);
        const camera = new THREE.PerspectiveCamera(
          50,
          (mount.clientWidth || 800) / Math.max(1, mount.clientHeight || 600),
          0.01,
          5000,
        );

        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (disposed) return;
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.autoRotate = autoRotateRef.current;
        controls.autoRotateSpeed = 1.6;

        scene.add(new THREE.HemisphereLight(0xd4d4d8, 0x1c1c1f, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 2.1);
        key.position.set(1.2, 1.9, 1.1);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.55);
        fill.position.set(-1.4, 0.4, -1.2);
        scene.add(fill);

        const loaded = await loadModel(k, bytes);
        if (disposed) {
          disposeObject(loaded.object);
          return;
        }
        object = loaded.object;

        const box = new THREE.Box3().setFromObject(object);
        if (!box || !isFinite(box.min.x) || (box.isEmpty && box.isEmpty())) {
          throw new Error("Model has no measurable geometry.");
        }
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(sphere.radius, 1e-3);
        const size = new THREE.Vector3();
        box.getSize(size);
        object.position.sub(sphere.center);
        scene.add(object);

        const grid = new THREE.GridHelper(radius * 4, 28, 0x3f3f46, 0x1f1f23);
        grid.position.y = -size.y / 2 - radius * 0.002;
        grid.visible = gridOnRef.current;
        scene.add(grid);

        // PDB point size relative to molecule scale
        object.traverse((o: any) => {
          if (o.isPoints) o.material.size = Math.max(radius * 0.022, 0.01);
        });

        // auto-fit camera
        const fitDist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.18;
        const dir = new THREE.Vector3(0.9, 0.55, 1).normalize();
        camera.position.copy(dir).multiplyScalar(fitDist);
        camera.near = Math.max(radius / 400, 0.001);
        camera.far = Math.max(fitDist * 40, 10);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
        controls.saveState();

        const materials = collectMaterials(object);
        if (wireframeRef.current) {
          for (const m of materials) if (m && "wireframe" in m) m.wireframe = true;
        }

        ro = new ResizeObserver(() => {
          const w = mount.clientWidth;
          const h = mount.clientHeight;
          if (!w || !h || !renderer) return;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        });
        ro.observe(mount);

        const api: SceneApi = { renderer, scene, camera, controls, grid, object, materials };
        apiRef.current = api;

        const tick = () => {
          if (disposed) return;
          raf = requestAnimationFrame(tick);
          if (controls) controls.update();
          renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(tick);

        setStats(computeStats(object, [size.x, size.y, size.z], loaded.pdb));
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
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          /DRACO|draco|KTX2|meshopt/i.test(msg)
            ? `${msg} Compressed glTF extensions are not supported in this viewer.`
            : msg,
        );
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
      if (object) disposeObject(object);
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
      const base = fileName.replace(/\.[^.]+$/, "") || "model";
      downloadBlob(blob, `${base}-omniscope.png`, "image/png");
    } catch {
      /* ignore capture failure */
    }
  }, [fileName]);

  const dimsLabel = stats ? stats.dims.map((d) => (Math.abs(d) >= 100 ? d.toFixed(0) : d.toFixed(2))).join(" × ") : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">
              <Box className="h-3 w-3" />
              {kind ? kind.toUpperCase() : "3D"}
            </Chip>
            {stats ? (
              <>
                <Chip>{formatNum(stats.vertices)} verts</Chip>
                <Chip>{stats.faces > 0 ? `${formatNum(stats.faces)} faces` : `${formatNum(stats.meshes)} meshes`}</Chip>
                <Chip>
                  <Ruler className="h-3 w-3" />
                  {dimsLabel}
                </Chip>
                {stats.pdb ? (
                  <>
                    <Chip tone="teal">
                      <Atom className="h-3 w-3" />
                      {formatNum(stats.pdb.atoms)} atoms
                    </Chip>
                    <Chip tone="amber">{formatNum(stats.pdb.bonds)} bonds</Chip>
                    <Chip>{formatNum(stats.pdb.residues)} residues</Chip>
                  </>
                ) : null}
              </>
            ) : null}
          </>
        }
        right={
          <>
            <ToolButton label="Wireframe" title="Toggle wireframe" active={wireframe} onClick={() => setWireframe((v) => !v)}>
              <Grid3x3 className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Spin" title="Toggle auto-rotate" active={autoRotate} onClick={() => setAutoRotate((v) => !v)}>
              <RotateCw className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Grid" title="Toggle grid floor" active={gridOn} onClick={() => setGridOn((v) => !v)}>
              <Layers className="h-3.5 w-3.5" />
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
            <LoadingState label="Parsing 3D model…" />
          </div>
        ) : null}
        {phase === "error" ? (
          <ErrorCard
            title="3D render failed"
            message={errorMsg ?? "Unknown error"}
            hint="Supported: GLB, glTF, OBJ, STL, PLY, COLLADA, 3MF and PDB molecular files."
          />
        ) : (
          <div ref={mountRef} className="absolute inset-0" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Box className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Drag to orbit · scroll to zoom · right-drag to pan
          {stats?.pdb?.title ? ` · ${stats.pdb.title}` : ""}
        </span>
        <span className="ml-auto hidden shrink-0 text-zinc-600 sm:inline">{fileName}</span>
      </div>
    </div>
  );
}
