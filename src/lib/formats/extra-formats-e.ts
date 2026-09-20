import type { RawFormat } from "@/lib/types";

/**
 * AUTHORED EXPANSION E — shaders, audio banks, mobile, game saves, science,
 * LUTs/color, office leftovers, fonts, emulation, packaging, geo, misc.
 */
export const EXTRA_FORMATS_E: RawFormat[] = [
  // ---------------- shaders / GPU ----------------
  { ext: ["wgsl"], name: "GPU Shader Source", cat: "code", viewer: "code" },
  { ext: ["spv"], name: "SPIR-V Binary Shader", cat: "system", viewer: "fallback", sig: "03 02 23 07" },
  { ext: ["xof"], name: "DirectX Mesh (X file)", cat: "3d", viewer: "three3d", sig: "78 6F 66 20" },

  // ---------------- audio banks / game audio ----------------
  { ext: ["wxd", "wxh"], name: "Wwise Audio", cat: "audio", viewer: "fallback" },
  { ext: ["mcb"], name: "Game Audio Container", cat: "audio", viewer: "fallback" },

  // ---------------- mobile ----------------
  { ext: ["art"], name: "ART Cache Image", cat: "system", viewer: "fallback" },
  { ext: ["ipa2"], name: "iOS App (alias slot)", cat: "other", viewer: "fallback" },

  // ---------------- game saves / data ----------------
  { ext: ["d2i", "d2x"], name: "Diablo II Item/Plugin", cat: "game", viewer: "fallback" },
  { ext: ["gcf2"], name: "Steam Cache (alias slot)", cat: "other", viewer: "fallback" },
  { ext: ["nbt2"], name: "NBT alias slot", cat: "other", viewer: "fallback" },

  // ---------------- color management / LUTs ----------------
  { ext: ["mlut"], name: "Color LUT", cat: "image", viewer: "text" },
  { ext: ["arx"], name: "Arriraw Metadata", cat: "video", viewer: "fallback" },

  // ---------------- science ----------------
  { ext: ["h5ad"], name: "Annotated Data Matrix", cat: "scientific", viewer: "fallback" },
  { ext: ["loom"], name: "Loom Single-Cell", cat: "scientific", viewer: "fallback" },
  { ext: ["mtx"], name: "Matrix Market", cat: "data", viewer: "text" },
  { ext: ["pairs"], name: "Chromatin Pairs", cat: "scientific", viewer: "text" },
  { ext: ["acq"], name: "Biopac Acquisition", cat: "scientific", viewer: "fallback" },
  { ext: ["mpr"], name: "Bio-Logic Electrochemistry", cat: "scientific", viewer: "text" },
  { ext: ["rcp", "rcs"], name: "Leica/ReCap Point Cloud", cat: "3d", viewer: "three3d" },

  // ---------------- geo / outdoor ----------------
  { ext: ["loc"], name: "Geocaching Loc XML", cat: "geo", viewer: "xml" },

  // ---------------- office / doc leftovers ----------------
  { ext: ["oxt"], name: "OpenOffice Extension", cat: "system", viewer: "archive", sig: "50 4B 03 04" },
  { ext: ["kwd", "kpr", "ksp"], name: "KOffice Document", cat: "document", viewer: "odf" },
  { ext: ["roff", "man", "ms"], name: "Roff Manual", cat: "text", viewer: "text" },
  { ext: ["rest"], name: "reStructuredText (alt)", cat: "document", viewer: "markdown" },
  { ext: ["ron"], name: "Rust Object Notation", cat: "data", viewer: "code" },
  { ext: ["otl"], name: "Ecco Outline", cat: "text", viewer: "text" },
  { ext: ["tid", "tw5", "tw4"], name: "TiddlyWiki", cat: "text", viewer: "text" },

  // ---------------- fonts ----------------
  { ext: ["gdr"], name: "Symbian Font", cat: "font", viewer: "font" },
  { ext: ["lwfn"], name: "Mac PostScript Font", cat: "font", viewer: "font" },

  // ---------------- emulation ----------------

  // ---------------- misc / dev conventions ----------------
  { ext: ["yarnrc.yml", "percy", "husky", "changeset", "vitest", "playwright", "cypress", "storybook", "vercel", "netlify", "route", "wrangler", "gitpod"], name: "Dev Config Convention", cat: "config", viewer: "code" },
  { ext: ["sublime-snippet"], name: "Sublime Text Resource", cat: "config", viewer: "json" },
  { ext: ["brackets.json"], name: "Brackets Config", cat: "config", viewer: "json" },
  { ext: ["devcontainer", "devcontainer.json"], name: "VS Code Dev Container", cat: "config", viewer: "json" },
  { ext: ["vsixmanifest"], name: "VS Extension Manifest", cat: "config", viewer: "xml" },
  { ext: ["watchmanconfig"], name: "Watchman Config", cat: "config", viewer: "json" },
  { ext: ["tern-config"], name: "Tern.js Project", cat: "config", viewer: "json" },
  { ext: ["gulpfile", "gulpfile.coffee", "rollup.config", "webpack.config", "vite.config", "astro.config", "tailwind.config", "postcss.config", "next.config", "svelte.config", "remix.config", "nuxt.config", "quasar.config", "solid.config", "metalsmith.config", "jasmine.json", "jekyll", "mkdocs", "yml.raml"], name: "Build Tool Config", cat: "config", viewer: "code" },
  { ext: ["graphql.config", "apollo.config", "relay.config", "gulp-ts"], name: "Tool Config (misc)", cat: "config", viewer: "code" },

  // ---------------- text-adjacent & notes ----------------
  { ext: ["ans"], name: "ANSI Art Text", cat: "text", viewer: "nfo", desc: "ANSI escape art with CP437." },
  { ext: ["ion"], name: "Norton Commander Info", cat: "text", viewer: "nfo" },
  { ext: ["bbs"], name: "BBS Text", cat: "text", viewer: "nfo" },

  // ---------------- data formats ----------------
  { ext: ["cvjson"], name: "Config JSON variant", cat: "config", viewer: "json" },
  { ext: ["vtt.json"], name: "Structured data (misc)", cat: "data", viewer: "json" },
  { ext: ["owx", "owl2", "trig", "nq"], name: "RDF Serialization", cat: "data", viewer: "text" },
  { ext: ["sparql"], name: "SPARQL Query", cat: "code", viewer: "code" },
  { ext: ["fwf"], name: "Fixed-Width Text", cat: "data", viewer: "text" },
  { ext: ["hledger"], name: "Plain-Text Accounting", cat: "data", viewer: "code" },

  // ---------------- capture / streaming ----------------
  { ext: ["rtpdump", "rtp"], name: "RTP Dump", cat: "network", viewer: "fallback" },

  // ---------------- versioning / patches ----------------
  { ext: ["xdelta3"], name: "Binary Delta", cat: "system", viewer: "fallback" },

  // ---------------- misc ----------------
  { ext: ["viminfo", "exrc", "ideavimrc"], name: "Vim Runtime Data", cat: "config", viewer: "code" },
  { ext: ["bash_history"], name: "Shell RC", cat: "config", viewer: "code" },
  { ext: ["tmux.conf", "nanorc", "slrnrc", "msmtprc"], name: "Dotfile RC", cat: "config", viewer: "code" },
  { ext: ["TAGS"], name: "Ctags Index", cat: "code", viewer: "text" },
  { ext: ["ID", "indent.pro"], name: "Dev Index", cat: "code", viewer: "text" },
];

