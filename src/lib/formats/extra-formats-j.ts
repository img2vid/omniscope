import type { RawFormat } from "@/lib/types";

/** AUTHORED EXPANSION J — Adobe presets, NLE projects, DCC tools, Qt, DJ, Ozi, WPS. */
export const EXTRA_FORMATS_J: RawFormat[] = [
  // ---------------- Adobe suite ----------------
  { ext: ["8bi", "8bf", "8ba", "8bc", "8be", "8bs", "8by"], name: "Photoshop Plug-in (8bf family)", cat: "system", viewer: "fallback" },
  { ext: ["asl"], name: "Photoshop Styles", cat: "image", viewer: "fallback" },
  { ext: ["acv"], name: "Photoshop Curves", cat: "image", viewer: "fallback" },
  { ext: ["amp"], name: "Photoshop Curves Map", cat: "image", viewer: "fallback" },
  { ext: ["ahu"], name: "Photoshop Hue/Sat", cat: "image", viewer: "fallback" },
  { ext: ["alv"], name: "Photoshop Levels", cat: "image", viewer: "fallback" },
  { ext: ["amw"], name: "Photoshop Mixer Tool", cat: "image", viewer: "fallback" },
  { ext: ["avh"], name: "Photoshop Variations", cat: "image", viewer: "fallback" },

  // ---------------- NLE / video tools ----------------
  { ext: ["sfk", "sfap0", "sfap1", "sfap2"], name: "Vegas Pro Project", cat: "video", viewer: "fallback" },
  { ext: ["avp"], name: "Avid Project/Bin", cat: "video", viewer: "fallback" },
  { ext: ["ppj"], name: "Premiere (legacy) Project", cat: "video", viewer: "text" },
  { ext: ["vpj"], name: "VideoPad Project", cat: "video", viewer: "fallback" },
  { ext: ["osp"], name: "OpenShot Project", cat: "video", viewer: "xml" },
  { ext: ["wgv"], name: "WavePad? no (slot)", cat: "other", viewer: "fallback" },
  { ext: ["vep"], name: "AVS Video Project", cat: "video", viewer: "fallback" },
  { ext: ["ivr"], name: "RealMedia Interactive", cat: "video", viewer: "fallback" },
  { ext: ["rti"], name: "RealTrack? (slot)", cat: "other", viewer: "fallback" },
  { ext: ["mav"], name: "Motion AVI? (slot)", cat: "other", viewer: "fallback" },
  { ext: ["nvc"], name: "Nero Vision Compilation", cat: "video", viewer: "fallback" },
  { ext: ["nrb", "nru", "nrv", "nri", "nrd", "nrm", "nr3"], name: "Nero Compilation", cat: "video", viewer: "fallback" },

  // ---------------- DCC / 3D ----------------
  { ext: ["zmt", "zbp", "zvr", "zsl"], name: "ZBrush Project/Tool", cat: "3d", viewer: "fallback" },
  { ext: ["mud"], name: "Mudbox Sculpt", cat: "3d", viewer: "fallback" },
  { ext: ["otllc", "hdanc"], name: "Houdini Scene/Asset", cat: "3d", viewer: "fallback" },
  { ext: ["rui"], name: "Rhino UI Layout", cat: "config", viewer: "fallback" },
  { ext: ["bimx"], name: "ArchiCAD BIMx Model", cat: "3d", viewer: "fallback" },
  { ext: ["gdl"], name: "ArchiCAD Geometric Description", cat: "code", viewer: "text" },
  { ext: ["spp"], name: "Substance Painter Project", cat: "3d", viewer: "fallback" },
  { ext: ["sbs"], name: "Substance Designer Graph", cat: "3d", viewer: "fallback" },
  { ext: ["sbsar"], name: "Substance Archive", cat: "3d", viewer: "fallback" },
  { ext: ["sbsprs"], name: "Substance Preset", cat: "3d", viewer: "fallback" },
  { ext: ["azr"], name: "Azure? no — Azur? (slot)", cat: "other", viewer: "fallback" },

  // ---------------- Qt / automation tools ----------------
  { ext: ["qm"], name: "Qt Compiled Translation", cat: "code", viewer: "fallback" },

  // ---------------- DJ / performance ----------------
  { ext: ["grv"], name: "Serato Groove? (slot)", cat: "other", viewer: "fallback" },

  // ---------------- Ozi / GPS extras ----------------
  { ext: ["an1"], name: "DeLorme Drawing", cat: "geo", viewer: "fallback" },
  { ext: ["lgg"], name: "Swiss Map Log? (slot)", cat: "other", viewer: "fallback" },
  { ext: ["ttg"], name: "TNT? — Gps (slot)", cat: "other", viewer: "fallback" },

  // ---------------- WPS / office extras ----------------
  { ext: ["dps"], name: "WPS Presentation", cat: "presentation", viewer: "pptx" },

  // ---------------- misc ----------------
  { ext: ["li8", "li9", "l10", "l11", "l12", "l13", "l14"], name: "Licensed? no — (slot)", cat: "other", viewer: "fallback" },
  { ext: ["metadata_never_index"], name: "Spotlight Control", cat: "other", viewer: "text" },
];
