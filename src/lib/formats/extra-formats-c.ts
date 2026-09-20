import type { RawFormat } from "@/lib/types";

/**
 * AUTHORED EXPANSION C — broadcast, music production, embedded/automotive, scientific
 * chemistry/physics, seismology, remote sensing, microscopy, databases, security,
 * content pipelines, telemetry, legacy platforms.
 */
export const EXTRA_FORMATS_C: RawFormat[] = [
  // ---------------- broadcast / A/V production ----------------
  { ext: ["aes31"], name: "AES31 Audio Project", cat: "audio", viewer: "text" },
  { ext: ["vag"], name: "Sony VAG Audio", cat: "audio", viewer: "fallback", sig: "56 41 47 70" },
  { ext: ["at3plus"], name: "ATRAC3plus", cat: "audio", viewer: "fallback" },
  { ext: ["msf"], name: "PS3 Music Container", cat: "audio", viewer: "fallback" },
  { ext: ["ick"], name: "iClock data", cat: "other", viewer: "fallback" },
  { ext: ["pts"], name: "Pro Tools Session Template", cat: "audio", viewer: "fallback" },
  { ext: ["aaxplugin"], name: "AAX Plugin", cat: "audio", viewer: "fallback" },
  { ext: ["vst3"], name: "VST3 Audio Plugin", cat: "audio", viewer: "fallback", sig: "56 37 37 33" },
  { ext: ["auplugin"], name: "Audio Unit Plugin", cat: "audio", viewer: "fallback" },
  { ext: ["clap"], name: "CLever Audio Plugin", cat: "audio", viewer: "fallback" },
  { ext: ["lv2"], name: "LV2 Plugin Bundle", cat: "audio", viewer: "fallback" },
  { ext: ["nkr", "nkc", "nkb"], name: "Kontakt Instrument/Library", cat: "audio", viewer: "fallback" },
  { ext: ["logic", "logicx"], name: "Logic Pro Project", cat: "audio", viewer: "fallback" },
  { ext: ["bwpreset", "bwproject"], name: "Bitwig Preset/Project", cat: "audio", viewer: "fallback" },
  { ext: ["reason2"], name: "Reason 2 Song", cat: "audio", viewer: "fallback" },
  { ext: ["rpp", "rpp-bak"], name: "REAPER Project", cat: "code", viewer: "code" },
  { ext: ["song", "studioone"], name: "Studio One Song", cat: "audio", viewer: "fallback" },
  { ext: ["cprx"], name: "Cubase Project (new)", cat: "audio", viewer: "fallback" },
  { ext: ["all"], name: "Cubase Arrangement", cat: "audio", viewer: "fallback" },
  { ext: ["nls"], name: "Cubase License", cat: "other", viewer: "fallback" },
  { ext: ["sck"], name: "Cubase Scale/Chord", cat: "other", viewer: "fallback" },

  // ---------------- embedded / automotive / industrial ----------------
  { ext: ["pdx"], name: "ODX/PDX Diagnostics Data", cat: "system", viewer: "fallback" },
  { ext: ["vbf"], name: "Volvo Binary Flash", cat: "system", viewer: "fallback" },
  { ext: ["ldf"], name: "LIN Description File", cat: "system", viewer: "text" },
  { ext: ["plcproj"], name: "PLC Project", cat: "system", viewer: "fallback" },
  { ext: ["l5x"], name: "RSLogix L5X Tag Export", cat: "system", viewer: "xml" },
  { ext: ["s7p"], name: "Siemens S7 Project", cat: "system", viewer: "fallback" },
  { ext: ["mcp"], name: "Mitsubishi PLC Program", cat: "system", viewer: "fallback" },
  { ext: ["mcx"], name: "MELSEC Config", cat: "system", viewer: "fallback" },
  { ext: ["svr"], name: "SCADA Runtime", cat: "system", viewer: "fallback" },
  { ext: ["opc"], name: "OPC Binary Node Set", cat: "system", viewer: "fallback" },
  { ext: ["ualdcfg"], name: "IEC 61131-3 Project", cat: "system", viewer: "fallback" },
  { ext: ["srec-automotive"], name: "SREC automotive image", cat: "system", viewer: "text" },

  // ---------------- scientific: quantum chemistry / MD ----------------
  { ext: ["gjc", "gau"], name: "Gaussian Input", cat: "scientific", viewer: "text" },
  { ext: ["fch"], name: "Gaussian Formatted Checkpoint", cat: "scientific", viewer: "text" },
  { ext: ["g03", "g09", "g16"], name: "Gaussian Output", cat: "scientific", viewer: "text" },
  { ext: ["mop"], name: "MOPAC Output", cat: "scientific", viewer: "text" },
  { ext: ["inp"], name: "Computational Chemistry Input", cat: "scientific", viewer: "text" },
  { ext: ["tpr"], name: "GROMACS Binary Run Data", cat: "scientific", viewer: "fallback" },
  { ext: ["abi"], name: "ABINIT Input", cat: "scientific", viewer: "text" },
  { ext: ["ago"], name: "ABINIT Output", cat: "scientific", viewer: "text" },
  { ext: ["castep"], name: "CASTEP Data", cat: "scientific", viewer: "text" },

  // ---------------- seismology / geophysics ----------------
  { ext: ["mseed", "miniseed"], name: "MiniSEED Stream", cat: "scientific", viewer: "fallback" },
  { ext: ["segd", "sgd"], name: "SEG-D Field Data", cat: "scientific", viewer: "fallback" },
  { ext: ["ph5"], name: "PASSCAL HDF5 Observation", cat: "scientific", viewer: "fallback" },

  // ---------------- remote sensing / earth observation ----------------
  { ext: ["nitf", "ntf"], name: "NITF Imagery", cat: "scientific", viewer: "fallback", sig: "4E 49 54 46 30 32 30" },
  { ext: ["cib", "cadrg"], name: "RPF/CIB/CADRG Raster", cat: "scientific", viewer: "fallback" },
  { ext: ["im3"], name: "Imagery Metadata", cat: "other", viewer: "fallback" },
  { ext: ["safe"], name: "Sentinel SAFE Manifest", cat: "scientific", viewer: "xml" },
  { ext: ["woa"], name: "World Ocean Atlas", cat: "scientific", viewer: "fallback" },
  { ext: ["argo"], name: "Argo Float Profile", cat: "scientific", viewer: "fallback" },
  { ext: ["gsb"], name: "NTv2 Geodetic Grid", cat: "geo", viewer: "fallback" },
  { ext: ["geogrid"], name: "WPS Geogrid", cat: "scientific", viewer: "fallback" },

  // ---------------- microscopy / bio-imaging ----------------
  { ext: ["nd2"], name: "Nikon Microscopy Image", cat: "scientific", viewer: "fallback" },
  { ext: ["zvi"], name: "Zeiss Image (legacy)", cat: "scientific", viewer: "fallback" },
  { ext: ["vmsscu"], name: "Hamamatsu Virtual Slide", cat: "scientific", viewer: "fallback" },
  { ext: ["isyntax"], name: "Philips iSyntax Slide", cat: "scientific", viewer: "fallback" },

  // ---------------- databases / data platforms ----------------
  { ext: ["fdb"], name: "Firebird Database", cat: "database", viewer: "fallback" },
  { ext: ["gdbk"], name: "Interbase Key File", cat: "database", viewer: "fallback" },
  { ext: ["dct", "dmo"], name: "FoxPro Library/Object", cat: "database", viewer: "fallback" },
  { ext: ["cdx2"], name: "dBase/FoxPro Index", cat: "database", viewer: "fallback" },
  { ext: ["fpt2"], name: "FoxPro Memo", cat: "database", viewer: "fallback" },
  { ext: ["px"], name: "Paradox Table", cat: "database", viewer: "fallback" },
  { ext: ["4db", "4dc", "4dr", "4dindex"], name: "4th Dimension Components", cat: "database", viewer: "fallback" },
  { ext: ["mdb2"], name: "MS Access (legacy alias)", cat: "database", viewer: "fallback" },
  { ext: ["accdr", "accdt"], name: "MS Access Runtime Artifact", cat: "database", viewer: "fallback" },
  { ext: ["sdb"], name: "SQL Server Compact DB", cat: "database", viewer: "fallback" },
  { ext: ["db2"], name: "DB2 Export", cat: "database", viewer: "fallback" },
  { ext: ["ib"], name: "Interbase DB", cat: "database", viewer: "fallback" },

  // ---------------- security / secrets ----------------
  { ext: ["opvault"], name: "1Password Vault", cat: "system", viewer: "json" },
  { ext: ["kbd"], name: "KeePass 1 Vault", cat: "system", viewer: "fallback" },
  { ext: ["keychain"], name: "Apple Keychain", cat: "system", viewer: "fallback" },
  { ext: ["bitwarden.json"], name: "Bitwarden Vault", cat: "system", viewer: "json" },
  { ext: ["lastpass.csv"], name: "LastPass Export", cat: "system", viewer: "csv" },
  { ext: ["keepasscsv"], name: "KeePass CSV Export", cat: "system", viewer: "csv" },
  { ext: ["enc"], name: "Encrypted Payload", cat: "system", viewer: "hex", desc: "Generic ciphertext — entropy analysis applies." },

  // ---------------- content pipelines / 3D interchange ----------------
  { ext: ["mtlx", "materialx"], name: "MaterialX Look", cat: "3d", viewer: "xml" },
  { ext: ["assbin"], name: "Assimp Binary", cat: "3d", viewer: "fallback", sig: "41 53 53 42" },
  { ext: ["lwo2", "lwob"], name: "LightWave Object", cat: "3d", viewer: "fallback" },
  { ext: ["smd2"], name: "Studiomdl Data (variant)", cat: "3d", viewer: "three3d" },
  { ext: ["i3d"], name: "Interactive 3D Scene", cat: "3d", viewer: "three3d" },
  { ext: ["x3dvrml"], name: "X3D VRML Encoding", cat: "3d", viewer: "three3d" },
  { ext: ["mpx"], name: "Houdini MPx Data", cat: "3d", viewer: "fallback" },
  { ext: ["pic2"], name: "Houdini Image", cat: "image", viewer: "image" },
  { ext: ["rat"], name: "Houdini Texture", cat: "image", viewer: "image" },

  // ---------------- telemetry / logging ----------------
  { ext: ["cef", "cef.json"], name: "ArcSight CEF", cat: "system", viewer: "text" },
  { ext: ["leef"], name: "QRadar LEEF", cat: "system", viewer: "text" },
  { ext: ["gelf"], name: "Graylog GELF", cat: "system", viewer: "json" },
  { ext: ["logfmt"], name: "logfmt Line Log", cat: "system", viewer: "text" },
  { ext: ["jrnld"], name: "systemd Export", cat: "system", viewer: "text" },
  { ext: ["etw"], name: "ETW Trace", cat: "system", viewer: "fallback" },

  // ---------------- legacy platforms ----------------
  { ext: ["adf2"], name: "Amiga Floppy (alias)", cat: "disk", viewer: "fallback" },
  { ext: ["fc2", "fc3", "fc4"], name: "Future Composer Module", cat: "audio", viewer: "midi" },
  { ext: ["binmac"], name: "MacBinary", cat: "system", viewer: "fallback" },
  { ext: ["w21"], name: "Word 2.0 Document", cat: "document", viewer: "fallback" },
  { ext: ["wp4", "wp5", "wp6", "wpd2"], name: "WordPerfect Variant", cat: "document", viewer: "fallback" },
  { ext: ["prs"], name: "Harvard Graphics", cat: "presentation", viewer: "fallback" },
  { ext: ["sh3", "shw"], name: "Harvard Graphics Presentation", cat: "presentation", viewer: "fallback" },
  { ext: ["pre"], name: "Freelance Presentation", cat: "presentation", viewer: "fallback" },
  { ext: ["ss2", "ss3"], name: "SuperCalc Spreadsheet", cat: "spreadsheet", viewer: "fallback" },
  { ext: ["wq1"], name: "Lotus 1-2-3 Release", cat: "spreadsheet", viewer: "xlsx" },
  { ext: ["wdb"], name: "Works Database", cat: "database", viewer: "fallback" },
  { ext: ["riffpad"], name: "RIFF Pad", cat: "other", viewer: "fallback" },
  { ext: ["archimate"], name: "ArchiMate Model", cat: "data", viewer: "xml" },
  { ext: ["sysml"], name: "SysML Model", cat: "data", viewer: "xml" },
  { ext: ["bpmn", "bpmn2"], name: "BPMN Process", cat: "data", viewer: "xml" },
  { ext: ["epc"], name: "Event-driven Process Chain", cat: "data", viewer: "xml" },
  { ext: ["xml.drawio"], name: "draw.io Diagram", cat: "data", viewer: "xml" },
  { ext: ["excalidraw"], name: "Excalidraw Scene", cat: "data", viewer: "json" },
  { ext: ["lottie"], name: "Lottie Animation", cat: "image", viewer: "json" },
  { ext: ["tgs"], name: "Telegram Sticker (Lottie)", cat: "image", viewer: "json" },
  { ext: ["riv"], name: "Rive Animation", cat: "image", viewer: "fallback" },
  { ext: ["m1a"], name: "MPEG Audio Layer (alias)", cat: "audio", viewer: "audio" },
  { ext: ["m2p"], name: "MPEG Program (alias)", cat: "video", viewer: "video" },
  { ext: ["h323"], name: "H.323 Multimedia", cat: "video", viewer: "fallback" },
  { ext: ["psize"], name: "Pixel Size", cat: "other", viewer: "fallback" },
];
