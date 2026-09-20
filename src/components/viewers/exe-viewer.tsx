"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import {
  ViewerToolbar, ViewerBody, ErrorCard, LoadingState, Chip, EmptyHint, SectionCard,
  InfoGrid, Field, Segmented,
} from "./viewer-ui";
import { cn, formatBytes, formatNum, shannonEntropy, latin1 } from "@/lib/utils";
import { u16le, u32le, u32be, asciiAt } from "@/lib/binary";
import { Cpu, FileCog, Boxes, Layers, Import, ShieldCheck, AlertTriangle, Binary } from "lucide-react";

/* ================================ models ================================ */

interface PeSection { name: string; vsize: number; rawSize: number; flags: string[]; entropy: number | null; }
interface PeImport { dll: string; count: number; names: string[]; }
interface PeModel {
  kind: "pe";
  bits: 32 | 64;
  machine: string;
  timestamp: number | null;
  characteristics: string[];
  peType: string;
  entryPoint: string;
  imageBase: string;
  subsystem: string;
  dllChars: string[];
  checksum: string;
  sections: PeSection[];
  imports: PeImport[];
  notes: string[];
}

interface ElfSection { name: string; type: string; size: number; offset: number; entsize: number; flags: string[]; }
interface ElfProgram { type: string; flags: string; vaddr: string; filesz: number; memsz: number; }
interface ElfModel {
  kind: "elf";
  bits: 32 | 64;
  endian: string;
  osabi: string;
  type: string;
  machine: string;
  entry: string;
  version: number;
  programs: ElfProgram[];
  sections: ElfSection[];
  needed: string[];
  soname: string | null;
  dynsymCount: number | null;
  notes: string[];
}

interface MachSegment { name: string; vmsize: number; filesize: number; fileoff: number; nsects: number; }
interface MachCommand { name: string; size: number; detail?: string; }
interface MachoModel {
  kind: "macho";
  bits: 32 | 64;
  endian: string;
  cpu: string;
  filetype: string;
  flags: string;
  uuid: string | null;
  platform: string | null;
  minos: string | null;
  entry: string | null;
  segments: MachSegment[];
  commands: MachCommand[];
  dylibs: { name: string; kind: string }[];
  notes: string[];
}

interface FatArch { cpu: string; offset: string; size: number; filetype: string; }
interface FatModel { kind: "fat"; arches: FatArch[]; notes: string[]; }

type ExecModel = PeModel | ElfModel | MachoModel | FatModel;

/* =============================== lookup maps =============================== */

const PE_MACHINES: Record<number, string> = {
  0x014c: "Intel 386 (x86)", 0x8664: "x86-64 (AMD64)", 0x01c0: "ARM (NT)", 0x01c4: "ARM Thumb-2",
  0xaa64: "ARM64 (AArch64)", 0x0200: "Itanium (IA-64)", 0x0ebc: "EFI byte code", 0x5064: "RISC-V 64",
  0x01f0: "PowerPC LE", 0x0166: "RISC 6000", 0x0284: "Alpha AXP", 0x01a2: "SH3", 0x01a6: "SH4",
};

const PE_CHARS: [number, string][] = [
  [0x0001, "RELOCS_STRIPPED"], [0x0002, "EXECUTABLE_IMAGE"], [0x0004, "LINE_NUMS_STRIPPED"],
  [0x0008, "LOCAL_SYMS_STRIPPED"], [0x0020, "LARGE_ADDRESS_AWARE"], [0x0100, "32BIT_MACHINE"],
  [0x0200, "DEBUG_STRIPPED"], [0x1000, "SYSTEM"], [0x2000, "DLL"], [0x8000, "BYTES_REVERSED_HI"],
];

const PE_DLLCHARS: [number, string][] = [
  [0x0020, "HIGH_ENTROPY_VA"], [0x0040, "DYNAMIC_BASE (ASLR)"], [0x0080, "FORCE_INTEGRITY"],
  [0x0100, "NX_COMPAT (DEP)"], [0x0200, "NO_ISOLATION"], [0x0400, "NO_SEH"], [0x0800, "NO_BIND"],
  [0x1000, "APPCONTAINER"], [0x2000, "WDM_DRIVER"], [0x4000, "GUARD_CF"], [0x8000, "TERMINAL_SERVER_AWARE"],
];

const PE_SUBSYSTEMS: Record<number, string> = {
  0: "Unknown", 1: "Native (driver)", 2: "Windows GUI", 3: "Windows Console (CUI)", 5: "OS/2 Console",
  7: "POSIX CUI", 8: "Native Windows", 9: "Windows CE GUI", 10: "EFI Application", 11: "EFI Boot Driver",
  12: "EFI Runtime Driver", 13: "EFI ROM", 14: "Xbox", 16: "Windows Boot Application",
};

const ELF_OSABI: Record<number, string> = {
  0: "UNIX System V", 1: "HP-UX", 2: "NetBSD", 3: "GNU / Linux", 6: "Sun Solaris", 7: "AIX", 8: "IRIX",
  9: "FreeBSD", 10: "Tru64 UNIX", 11: "Novell Modesto", 12: "OpenBSD", 13: "OpenVMS", 97: "ARM EABI", 255: "Standalone",
};

const ELF_TYPES: Record<number, string> = {
  0: "None", 1: "REL — relocatable object", 2: "EXEC — executable", 3: "DYN — shared object / PIE", 4: "CORE — core dump",
};

const ELF_MACHINES: Record<number, string> = {
  2: "SPARC", 3: "x86 (i386)", 4: "Motorola 68000", 5: "Motorola 88000", 7: "MIPS", 8: "MIPS (alt)",
  15: "HPPA (PA-RISC)", 18: "SPARC32+", 20: "PowerPC", 21: "PowerPC 64", 22: "S390 / zSeries",
  40: "ARM (32-bit)", 42: "SuperH", 43: "SPARC v9", 50: "Itanium (IA-64)", 62: "x86-64 (AMD64)",
  75: "VAX", 76: "CRIS", 88: "Renesas M32R", 93: "ARC", 94: "Xtensa", 183: "AArch64 (ARM64)",
  243: "RISC-V", 258: "LoongArch",
};

const ELF_SHT: Record<number, string> = {
  0: "NULL", 1: "PROGBITS", 2: "SYMTAB", 3: "STRTAB", 4: "RELA", 5: "HASH", 6: "DYNAMIC", 7: "NOTE",
  8: "NOBITS", 9: "REL", 10: "SHLIB", 11: "DYNSYM", 14: "INIT_ARRAY", 15: "FINI_ARRAY",
  0x6ffffff5: "GNU_ATTRIBUTES", 0x6ffffff6: "GNU_HASH", 0x6ffffffd: "GNU_verdef", 0x6ffffffe: "GNU_verneed", 0x6fffffff: "GNU_versym",
};

const ELF_PT: Record<number, string> = {
  0: "NULL", 1: "LOAD", 2: "DYNAMIC", 3: "INTERP", 4: "NOTE", 5: "SHLIB", 6: "PHDR", 7: "TLS",
  0x6474e550: "GNU_EH_FRAME", 0x6474e551: "GNU_STACK", 0x6474e552: "GNU_RELRO", 0x6474e553: "GNU_PROPERTY",
  0x70000000: "LOPROC+",
};

const MACHO_CPU: Record<number, string> = {
  1: "VAX", 6: "MC680x0", 7: "x86 (i386)", 8: "MIPS", 10: "MC98000 (PowerPC)", 11: "HPPA",
  12: "ARM", 13: "MC88000", 14: "SPARC", 15: "i860", 16: "Alpha", 18: "PowerPC",
  0x01000007: "x86_64", 0x0100000c: "ARM64 (AArch64)", 0x01000012: "PowerPC64", 0x0200000c: "ARM64_32",
};

const MACHO_FILETYPES: Record<number, string> = {
  1: "Object", 2: "Executable", 3: "Fixed VM shared lib", 4: "Core dump", 5: "Preload executable",
  6: "Bundle", 7: "Shared dylib", 8: "Dynamic linker", 9: "BOND", 0xa: "Dylib stub", 0xb: "Debug companion (dSYM)", 0xc: "KEXT bundle",
};

const MACHO_PLATFORMS: Record<number, string> = {
  1: "macOS", 2: "iOS", 3: "tvOS", 4: "watchOS", 5: "bridgeOS", 6: "macOS Catalyst", 7: "iOS Simulator",
  9: "tvOS Simulator", 10: "watchOS Simulator", 11: "DriverKit", 12: "visionOS", 13: "visionOS Simulator",
};

const MACHO_CMDS: Record<number, string> = {
  0x1: "LC_SEGMENT", 0x2: "LC_SYMTAB", 0x3: "LC_SYMSEG", 0x4: "LC_THREAD", 0x5: "LC_UNIXTHREAD",
  0x8: "LC_LOADFVMLIB", 0x9: "LC_IDFVMLIB", 0xa: "LC_IDENT", 0xb: "LC_DYSYMTAB", 0xc: "LC_LOAD_DYLIB",
  0xd: "LC_ID_DYLIB", 0xe: "LC_LOAD_DYLINKER", 0xf: "LC_ID_DYLINKER", 0x10: "LC_PREBOUND_DYLIB",
  0x11: "LC_ROUTINES", 0x12: "LC_SUB_FRAMEWORK", 0x13: "LC_SUB_UMBRELLA", 0x14: "LC_SUB_CLIENT",
  0x15: "LC_SUB_LIBRARY", 0x16: "LC_TWOLEVEL_HINTS", 0x17: "LC_PREBIND_CKSUM", 0x18: "LC_LOAD_WEAK_DYLIB",
  0x19: "LC_SEGMENT_64", 0x1a: "LC_ROUTINES_64", 0x1b: "LC_UUID", 0x1c: "LC_RPATH (base)",
  0x1d: "LC_CODE_SIGNATURE (base)", 0x1e: "LC_SEGMENT_SPLIT_INFO (base)", 0x1f: "LC_REEXPORT_DYLIB (base)",
  0x20: "LC_LAZY_LOAD_DYLIB", 0x21: "LC_ENCRYPTION_INFO (base)", 0x22: "LC_DYLD_INFO", 0x23: "LC_DYLD_INFO_ONLY",
  0x24: "LC_VERSION_MIN_MACOSX", 0x25: "LC_VERSION_MIN_IPHONEOS", 0x26: "LC_FUNCTION_STARTS (base)",
  0x29: "LC_BUILD_VERSION", 0x2a: "LC_SOURCE_VERSION", 0x2b: "LC_DYLD_EXPORTS_TRIE", 0x80000018: "LC_LOAD_WEAK_DYLIB",
  0x8000001c: "LC_RPATH", 0x8000001d: "LC_CODE_SIGNATURE", 0x8000001e: "LC_SEGMENT_SPLIT_INFO",
  0x8000001f: "LC_REEXPORT_DYLIB", 0x80000020: "LC_LAZY_LOAD_DYLIB", 0x80000021: "LC_ENCRYPTION_INFO",
  0x80000022: "LC_DYLD_INFO_ONLY", 0x80000023: "LC_DYLD_EXPORTS_TRIE", 0x80000026: "LC_FUNCTION_STARTS",
  0x80000028: "LC_MAIN", 0x80000029: "LC_DATA_IN_CODE", 0x8000002a: "LC_SOURCE_VERSION",
  0x8000002b: "LC_DYLIB_CODE_SIGN_DRS", 0x8000002c: "LC_ENCRYPTION_INFO_64", 0x8000002d: "LC_LINKER_OPTION",
  0x8000002e: "LC_LINKER_OPTIMIZATION_HINT", 0x80000031: "LC_EXPORTS_TRIE", 0x80000032: "LC_CHAINED_FIXUPS",
  0x80000033: "LC_FILESET_ENTRY",
};

const DYLIB_KINDS: Record<number, string> = {
  0x0c: "LC_LOAD_DYLIB", 0x0d: "LC_ID_DYLIB", 0x80000018: "LC_LOAD_WEAK_DYLIB", 0x8000001f: "LC_REEXPORT_DYLIB", 0x20: "LC_LAZY_LOAD_DYLIB",
};

/* =============================== byte helpers =============================== */

function cstrAt(b: Uint8Array, o: number, max = 256): string {
  let s = "";
  const end = Math.min(o + max, b.length);
  for (let i = Math.max(0, o); i < end; i++) {
    const c = b[i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function hexv(v: number): string {
  return "0x" + v.toString(16);
}

function u64le(b: Uint8Array, o: number): number {
  return u32le(b, o + 4) * 4294967296 + u32le(b, o);
}

function u64be(b: Uint8Array, o: number): number {
  return u32be(b, o) * 4294967296 + u32be(b, o + 4);
}

function formatUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes).map((x) => x.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

/* ==================================== PE ==================================== */

function parsePe(b: Uint8Array): PeModel {
  const notes: string[] = [];
  if (b.length < 0x40 || u16le(b, 0) !== 0x5a4d) throw new Error("MZ signature missing.");
  const peOff = u32le(b, 0x3c);
  if (peOff < 0 || peOff + 24 > b.length) throw new Error("e_lfanew points outside the file.");
  if (u32le(b, peOff) !== 0x00004550) throw new Error("PE\\0\\0 signature missing at e_lfanew.");
  const machine = u16le(b, peOff + 4);
  const numSections = u16le(b, peOff + 6);
  const ts = u32le(b, peOff + 8);
  const sizeOpt = u16le(b, peOff + 20);
  const chars = u16le(b, peOff + 22);
  const optOff = peOff + 24;
  const magic = u16le(b, optOff);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`Unknown optional header magic 0x${magic.toString(16)}.`);
  const bits: 32 | 64 = magic === 0x20b ? 64 : 32;
  const entryRva = u32le(b, optOff + 16);
  const imageBase = bits === 64 ? u64le(b, optOff + 24) : u32le(b, optOff + 28);
  const checksum = u32le(b, optOff + 64);
  const subsystem = u16le(b, optOff + 68);
  const dllChars = u16le(b, optOff + 70);
  const numRva = u32le(b, optOff + (bits === 64 ? 108 : 92));
  const dataDir = optOff + (bits === 64 ? 112 : 96);
  const importRva = numRva > 1 ? u32le(b, dataDir + 8) : 0;

  const sections: PeSection[] = [];
  const secMap: { va: number; rawPtr: number; rawSize: number; vsize: number }[] = [];
  const secOff = optOff + sizeOpt;
  for (let i = 0; i < numSections && i < 96; i++) {
    const o = secOff + i * 40;
    if (o + 40 > b.length) { notes.push("Section table truncated at the end of the loaded bytes."); break; }
    const name = latin1(b.subarray(o, o + 8)).replace(/\0.*$/g, "") || `s${i}`;
    const vsize = u32le(b, o + 8);
    const va = u32le(b, o + 12);
    const rawSize = u32le(b, o + 16);
    const rawPtr = u32le(b, o + 20);
    const sc = u32le(b, o + 36);
    const flags: string[] = [];
    if (sc & 0x20) flags.push("CODE");
    if (sc & 0x40) flags.push("IDATA");
    if (sc & 0x80) flags.push("UDATA");
    if (sc & 0x02000000) flags.push("DISCARD");
    if (sc & 0x04000000) flags.push("X");
    if (sc & 0x40000000) flags.push("R");
    if (sc & 0x80000000) flags.push("W");
    let entropy: number | null = null;
    if (rawSize > 0) {
      if (rawPtr < b.length && rawPtr + rawSize <= b.length) entropy = shannonEntropy(b.subarray(rawPtr, rawPtr + rawSize));
      else notes.push(`Section “${name}” extends beyond the loaded bytes — entropy skipped.`);
    }
    sections.push({ name, vsize, rawSize, flags, entropy });
    secMap.push({ va, rawPtr, rawSize, vsize });
  }

  const imports = parsePeImports(b, importRva, secMap, bits === 64, notes);
  if (!importRva) notes.push("No import directory — statically linked or imports hidden (packed).");
  else if (!imports.length) notes.push("Import table could not be resolved within the loaded bytes.");

  let timestamp: number | null = null;
  if (ts) {
    const d = new Date(ts * 1000);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() >= 1980 && d.getUTCFullYear() <= 2100) timestamp = ts * 1000;
    else notes.push(`Timestamp 0x${ts.toString(16)} is outside a plausible range (reproducible / fuzzed build?).`);
  }

  return {
    kind: "pe",
    bits,
    machine: PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}`,
    timestamp,
    characteristics: PE_CHARS.filter(([m]) => (chars & m) === m).map(([, n]) => n),
    peType: bits === 64 ? "PE32+ (64-bit)" : "PE32 (32-bit)",
    entryPoint: hexv(imageBase + entryRva),
    imageBase: hexv(imageBase),
    subsystem: PE_SUBSYSTEMS[subsystem] ?? `subsystem ${subsystem}`,
    dllChars: PE_DLLCHARS.filter(([m]) => (dllChars & m) === m).map(([, n]) => n),
    checksum: checksum.toString(16).toUpperCase().padStart(8, "0"),
    sections,
    imports,
    notes,
  };
}

function parsePeImports(
  b: Uint8Array, importRva: number, secMap: { va: number; rawPtr: number; rawSize: number; vsize: number }[],
  is64: boolean, notes: string[],
): PeImport[] {
  if (!importRva) return [];
  const rvaToOff = (rva: number): number | null => {
    for (const s of secMap) {
      const size = Math.max(s.vsize, s.rawSize);
      if (rva >= s.va && rva < s.va + size) return rva - s.va + s.rawPtr;
    }
    return null;
  };
  const out: PeImport[] = [];
  let off = rvaToOff(importRva);
  if (off == null) return out;
  let guard = 0;
  while (off + 20 <= b.length && guard++ < 2048) {
    const nameRva = u32le(b, off + 12);
    const oftRva = u32le(b, off + 0);
    const ftRva = u32le(b, off + 16);
    if (nameRva === 0 && oftRva === 0 && ftRva === 0) break;
    const nameOff = rvaToOff(nameRva);
    if (nameOff == null || nameOff >= b.length) { notes.push("An import descriptor points outside the file — import walk stopped."); break; }
    const dll = cstrAt(b, nameOff) || "<unnamed>";
    const thunkRva = oftRva || ftRva;
    const names: string[] = [];
    let total = 0;
    const toff0 = rvaToOff(thunkRva);
    if (toff0 != null) {
      const step = is64 ? 8 : 4;
      let toff = toff0;
      let g2 = 0;
      while (toff + step <= b.length && g2++ < 20000) {
        const vLo = u32le(b, toff);
        const vHi = is64 ? u32le(b, toff + 4) : 0;
        if (vLo === 0 && vHi === 0) break;
        const isOrdinal = is64 ? (vHi & 0x80000000) !== 0 : (vLo & 0x80000000) !== 0;
        total++;
        if (isOrdinal) {
          if (names.length < 10) names.push(`#${vLo & 0xffff} (ordinal)`);
        } else {
          const nOff = rvaToOff(vLo);
          if (nOff != null && nOff + 2 < b.length) {
            if (names.length < 10) names.push(cstrAt(b, nOff + 2));
          } else if (names.length < 10) names.push("<unresolved>");
        }
        toff += step;
      }
    }
    out.push({ dll, count: total, names });
    off += 20;
  }
  return out;
}

/* ==================================== ELF ==================================== */

function parseElf(b: Uint8Array): ElfModel {
  const notes: string[] = [];
  if (b.length < 52 || asciiAt(b, 0, 4) !== "\x7fELF") throw new Error("ELF magic (7F 45 4C 46) missing.");
  const is64 = b[4] === 2;
  const le = b[5] === 1;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const u64 = (o: number) => (le ? u32(o + 4) * 4294967296 + u32(o) : u32(o) * 4294967296 + u32(o + 4));

  const eType = u16(16);
  const machine = u16(18);
  const version = u32(20);
  const entry = is64 ? u64(24) : u32(24);
  const phoff = is64 ? u64(32) : u32(28);
  const shoff = is64 ? u64(40) : u32(32);
  const phentsize = u16(is64 ? 54 : 42);
  const phnum = u16(is64 ? 56 : 44);
  const shentsize = u16(is64 ? 58 : 46);
  const shnum = u16(is64 ? 60 : 48);
  const shstrndx = u16(is64 ? 62 : 50);

  const rawSections: { nameOff: number; type: number; flags: number; offset: number; size: number; entsize: number }[] = [];
  for (let i = 0; i < shnum && i < 4096; i++) {
    const o = shoff + i * shentsize;
    if (o < 0 || o + shentsize > b.length) { notes.push("Section header table truncated."); break; }
    rawSections.push({
      nameOff: u32(o),
      type: u32(o + 4),
      flags: is64 ? u64(o + 8) : u32(o + 8),
      offset: is64 ? u64(o + 24) : u32(o + 16),
      size: is64 ? u64(o + 32) : u32(o + 20),
      entsize: is64 ? u64(o + 56) : u32(o + 36),
    });
  }
  let shstr: Uint8Array | null = null;
  if (shstrndx > 0 && shstrndx < rawSections.length) {
    const s = rawSections[shstrndx];
    if (s.offset + s.size <= b.length && s.offset >= 0) shstr = b.subarray(s.offset, s.offset + s.size);
    else notes.push(".shstrtab not fully inside the loaded bytes — section names unavailable.");
  }
  const nameOf = (nameOff: number) => (shstr ? cstrAt(shstr, nameOff) : "");

  const sections: ElfSection[] = rawSections.map((s) => {
    const flags: string[] = [];
    if (s.flags & 1) flags.push("W");
    if (s.flags & 2) flags.push("A");
    if (s.flags & 4) flags.push("X");
    return {
      name: nameOf(s.nameOff) || `<${ELF_SHT[s.type] ?? "sec"}.${s.nameOff}>`,
      type: ELF_SHT[s.type] ?? `0x${s.type.toString(16)}`,
      size: s.size,
      offset: s.offset,
      entsize: s.entsize,
      flags,
    };
  });

  const dyn = sections.find((s) => s.name === ".dynamic");
  const dynstr = sections.find((s) => s.name === ".dynstr");
  const needed: string[] = [];
  let soname: string | null = null;
  if (dyn && dynstr && dyn.offset + dyn.size <= b.length && dynstr.offset + dynstr.size <= b.length && dyn.offset >= 0 && dynstr.offset >= 0) {
    const strTab = b.subarray(dynstr.offset, dynstr.offset + dynstr.size);
    const step = is64 ? 16 : 8;
    let o = dyn.offset;
    let guard = 0;
    while (o + step <= dyn.offset + dyn.size && guard++ < 1024) {
      const tag = is64 ? u64(o) : u32(o);
      const val = is64 ? u64(o + 8) : u32(o + 4);
      if (tag === 0) break;
      if (tag === 1 && val < strTab.length) needed.push(cstrAt(strTab, val));
      else if (tag === 14 && val < strTab.length) soname = cstrAt(strTab, val);
      o += step;
    }
  } else if (dyn) notes.push("Dynamic section not fully inside the loaded bytes — dependencies not resolved.");

  const dynsym = sections.find((s) => s.name === ".dynsym");
  const dynsymCount = dynsym && dynsym.entsize > 0 ? Math.floor(dynsym.size / dynsym.entsize) : null;

  const programs: ElfProgram[] = [];
  for (let i = 0; i < phnum && i < 256; i++) {
    const o = phoff + i * phentsize;
    const need = is64 ? 56 : 32;
    if (o < 0 || o + need > b.length) { notes.push("Program header table truncated."); break; }
    const type = u32(o);
    const flags = is64 ? u32(o + 4) : u32(o + 24);
    const vaddr = is64 ? u64(o + 16) : u32(o + 8);
    const filesz = is64 ? u64(o + 32) : u32(o + 16);
    const memsz = is64 ? u64(o + 40) : u32(o + 20);
    const f = `${flags & 4 ? "R" : "-"}${flags & 2 ? "W" : "-"}${flags & 1 ? "X" : "-"}`;
    programs.push({ type: ELF_PT[type] ?? `0x${type.toString(16)}`, flags: f, vaddr: hexv(vaddr), filesz, memsz });
  }
  if (shnum === 0) notes.push("No section headers — the file is fully stripped or prelinked.");

  return {
    kind: "elf",
    bits: is64 ? 64 : 32,
    endian: le ? "Little" : "Big",
    osabi: ELF_OSABI[b[7]] ?? `OSABI ${b[7]}`,
    type: ELF_TYPES[eType] ?? `type ${eType}`,
    machine: ELF_MACHINES[machine] ?? `machine ${machine}`,
    entry: hexv(entry),
    version,
    programs,
    sections,
    needed,
    soname,
    dynsymCount,
    notes,
  };
}

/* ================================== Mach-O ================================== */

function parseMachO(b: Uint8Array, base = 0): MachoModel {
  const notes: string[] = [];
  const m = u32le(b, base);
  const bits: 32 | 64 = m === 0xfeedfacf || m === 0xcffaedfe ? 64 : 32;
  const le = m === 0xfeedface || m === 0xfeedfacf;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const rd32 = (o: number) => dv.getUint32(o, le);
  const rd64 = (o: number) => (le ? rd32(o + 4) * 4294967296 + rd32(o) : rd32(o) * 4294967296 + rd32(o + 4));

  const cputype = rd32(base + 4);
  const filetype = rd32(base + 12);
  const ncmds = rd32(base + 16);
  const flags = rd32(base + 24);

  const segments: MachSegment[] = [];
  const commands: MachCommand[] = [];
  const dylibs: { name: string; kind: string }[] = [];
  let uuid: string | null = null;
  let platform: string | null = null;
  let minos: string | null = null;
  let entry: string | null = null;

  let off = base + (bits === 64 ? 32 : 28);
  for (let i = 0; i < ncmds && i < 4096; i++) {
    if (off + 8 > b.length) { notes.push("Load commands truncated."); break; }
    const cmd = rd32(off);
    const size = rd32(off + 4);
    if (size < 8 || off + size > b.length) { notes.push(`Corrupt load command 0x${cmd.toString(16)} — walk stopped.`); break; }
    if (cmd === 0x1 || cmd === 0x19) {
      const isSeg64 = cmd === 0x19;
      const name = latin1(b.subarray(off + 8, off + 24)).replace(/\0.*$/g, "") || "?";
      const vmsize = isSeg64 ? rd64(off + 32) : rd32(off + 28);
      const fileoff = isSeg64 ? rd64(off + 40) : rd32(off + 32);
      const filesize = isSeg64 ? rd64(off + 48) : rd32(off + 36);
      const nsects = isSeg64 ? rd32(off + 64) : rd32(off + 48);
      segments.push({ name, vmsize, filesize, fileoff, nsects });
      commands.push({ name: isSeg64 ? "LC_SEGMENT_64" : "LC_SEGMENT", size, detail: `${name} — ${formatBytes(vmsize)} VM / ${formatBytes(filesize)} file · ${nsects} sections` });
    } else if (cmd === 0x1d || cmd === 0x1b) {
      uuid = formatUuid(b.subarray(off + 8, off + 24));
      commands.push({ name: cmd === 0x1d ? "LC_UUID" : "LC_SYMSEG", size, detail: uuid });
    } else if (cmd === 0x29) {
      const plat = rd32(off + 8);
      const min = rd32(off + 12);
      platform = MACHO_PLATFORMS[plat] ?? `platform ${plat}`;
      minos = `${(min >> 16) & 0xffff}.${(min >> 8) & 0xff}${min & 0xff ? "." + (min & 0xff) : ""}`;
      commands.push({ name: "LC_BUILD_VERSION", size, detail: `${platform} ≥ ${minos}` });
    } else if (DYLIB_KINDS[cmd]) {
      const nameOff = rd32(off + 8);
      const nm = nameOff < size && off + nameOff < b.length ? cstrAt(b, off + nameOff, size - 8) : "?";
      dylibs.push({ name: nm, kind: DYLIB_KINDS[cmd] });
      commands.push({ name: DYLIB_KINDS[cmd], size, detail: nm });
    } else if (cmd === 0x80000028) {
      entry = hexv(rd64(off + 8));
      commands.push({ name: "LC_MAIN", size, detail: `entry at ${entry}` });
    } else if (cmd === 0x1e || cmd === 0xf) {
      const nameOff = rd32(off + 8);
      const nm = nameOff < size && off + nameOff < b.length ? cstrAt(b, off + nameOff, size - 8) : "?";
      commands.push({ name: cmd === 0x1e ? "LC_LOAD_DYLINKER" : "LC_ID_DYLINKER", size, detail: nm });
    } else if (cmd === 0x2) {
      commands.push({ name: "LC_SYMTAB", size, detail: `${rd32(off + 8)} symbols` });
    } else {
      commands.push({ name: MACHO_CMDS[cmd] ?? `cmd 0x${cmd.toString(16)}`, size });
    }
    off += size;
  }
  if (!dylibs.length) notes.push("No LC_LOAD_DYLIB commands — the binary is self-contained.");

  return {
    kind: "macho",
    bits,
    endian: le ? "Little" : "Big",
    cpu: MACHO_CPU[cputype] ?? `cputype ${cputype}`,
    filetype: MACHO_FILETYPES[filetype] ?? `filetype ${filetype}`,
    flags: hexv(flags),
    uuid,
    platform,
    minos,
    entry,
    segments,
    commands,
    dylibs,
    notes,
  };
}

function parseFat(b: Uint8Array): FatModel {
  const notes: string[] = [];
  const nfat = u32be(b, 4);
  if (nfat > 64) notes.push("Implausible architecture count — list truncated.");
  const arches: FatArch[] = [];
  const count = Math.min(nfat, 64);
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 20;
    if (o + 20 > b.length) break;
    const cputype = u32be(b, o);
    const offset = u32be(b, o + 8);
    const size = u32be(b, o + 12);
    let ft = "—";
    if (offset + 16 <= b.length) {
      const mm = u32le(b, offset);
      const le = mm === 0xfeedface || mm === 0xfeedfacf;
      ft = MACHO_FILETYPES[new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset + 12, le)] ?? "?";
    }
    arches.push({ cpu: MACHO_CPU[cputype] ?? `cputype ${cputype}`, offset: hexv(offset), size, filetype: ft });
  }
  return { kind: "fat", arches, notes };
}

function parseExecutable(b: Uint8Array): ExecModel {
  if (b.length >= 2 && u16le(b, 0) === 0x5a4d) return parsePe(b);
  if (b.length >= 4 && asciiAt(b, 0, 4) === "\x7fELF") return parseElf(b);
  const m = u32le(b, 0);
  if (m === 0xfeedface || m === 0xfeedfacf || m === 0xcefaedfe || m === 0xcffaedfe) return parseMachO(b);
  if (m === 0xbebafeca || u32be(b, 0) === 0xcafebabe) {
    if (u32be(b, 0) === 0xcafebabe && b[4] === 0) {
      // Java class files share the fat magic — only treat real fat binaries here
      return parseFat(b);
    }
    return parseFat(b);
  }
  throw new Error("No PE (MZ), ELF, or Mach-O signature found.");
}

/* ================================ UI pieces ================================ */

function EntropyBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full", value > 7 ? "bg-amber-400" : "bg-emerald-500")}
          style={{ width: `${(value / 8) * 100}%` }}
        />
      </div>
      <span className={cn("tabular-nums", value > 7 ? "text-amber-300" : "text-zinc-400")}>{value.toFixed(2)}</span>
    </div>
  );
}

function NotesStrip({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="space-y-1">
      {notes.map((n, i) => (
        <div key={i} className="flex items-start gap-2 rounded border border-amber-900/50 bg-amber-950/20 p-2 text-[11px] leading-relaxed text-amber-300/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {n}
        </div>
      ))}
    </div>
  );
}

/* ================================== viewer ================================== */

export default function ExeViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [model, setModel] = React.useState<ExecModel | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [panel, setPanel] = React.useState<"summary" | "sections" | "imports">("summary");

  React.useEffect(() => {
    setErr(null);
    setModel(null);
    try {
      const bytes = arrayBuffer ? new Uint8Array(arrayBuffer) : head;
      setModel(parseExecutable(bytes));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [arrayBuffer, head]);

  if (err) return <ErrorCard title="Could not parse executable" message={err} />;
  if (!model) return <LoadingState label="Parsing executable headers…" />;

  const fmtChip =
    model.kind === "pe" ? "PE / COFF" : model.kind === "elf" ? "ELF" : model.kind === "macho" ? "Mach-O" : "Mach-O fat binary";
  const hasImports =
    model.kind === "pe" ? model.imports.length > 0 :
    model.kind === "elf" ? model.needed.length > 0 || model.soname != null || model.dynsymCount != null :
    model.kind === "macho" ? model.dylibs.length > 0 : false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald"><FileCog className="h-3 w-3" />{fmtChip}</Chip>
            {model.kind !== "fat" ? <Chip>{model.bits === 64 ? "64-bit" : "32-bit"}</Chip> : null}
            {model.kind === "pe" ? <Chip tone="teal">{model.machine}</Chip> : null}
            {model.kind === "elf" ? <Chip tone="teal">{model.machine}</Chip> : null}
            {model.kind === "macho" ? <Chip tone="teal">{model.cpu}</Chip> : null}
            {model.kind === "fat" ? <Chip tone="teal">{model.arches.length} architectures</Chip> : null}
            {model.kind === "elf" ? <Chip>{model.type.split(" ")[0]}</Chip> : null}
            {model.kind === "macho" ? <Chip>{model.filetype}</Chip> : null}
          </>
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "summary", label: "Summary" },
              { value: "sections", label: model.kind === "macho" ? "Segments" : "Sections" },
              { value: "imports", label: model.kind === "elf" ? "Libraries" : "Imports" },
            ]}
          />
        }
      />
      <ViewerBody className="p-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {panel === "summary" ? (
            <>
              {model.kind === "pe" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="PE identity" icon={<Cpu className="h-3.5 w-3.5" />}>
                    <InfoGrid>
                      <Field label="Type">{model.peType}</Field>
                      <Field label="Machine">{model.machine}</Field>
                      <Field label="Subsystem">{model.subsystem}</Field>
                      <Field label="Compiled">{model.timestamp ? new Date(model.timestamp).toUTCString() : "—"}</Field>
                      <Field label="Entry point" mono>{model.entryPoint}</Field>
                      <Field label="Image base" mono>{model.imageBase}</Field>
                      <Field label="Checksum" mono>{model.checksum}</Field>
                      <Field label="Sections">{formatNum(model.sections.length)}</Field>
                    </InfoGrid>
                  </SectionCard>
                  <SectionCard title="Hardening & flags" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {model.dllChars.length ? model.dllChars.map((c) => (
                        <Chip key={c} tone={c.startsWith("DYNAMIC") || c.startsWith("NX") || c.startsWith("GUARD") ? "emerald" : "zinc"}>{c}</Chip>
                      )) : <Chip tone="amber">no modern hardening flags set</Chip>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {model.characteristics.map((c) => <Chip key={c}>{c}</Chip>)}
                    </div>
                    {!model.dllChars.some((c) => c.includes("DYNAMIC_BASE")) ? (
                      <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] leading-relaxed text-zinc-500">
                        DYNAMIC_BASE absent → no ASLR. NX_COMPAT absent → no DEP. GUARD_CF absent → no Control Flow Guard.
                      </p>
                    ) : null}
                  </SectionCard>
                </div>
              ) : null}
              {model.kind === "elf" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="ELF identity" icon={<Cpu className="h-3.5 w-3.5" />}>
                    <InfoGrid>
                      <Field label="Class">ELF{model.bits}</Field>
                      <Field label="Endianness">{model.endian}</Field>
                      <Field label="Type">{model.type}</Field>
                      <Field label="Machine">{model.machine}</Field>
                      <Field label="OS / ABI">{model.osabi}</Field>
                      <Field label="Entry point" mono>{model.entry}</Field>
                      <Field label="Sections">{formatNum(model.sections.length)}</Field>
                      <Field label="Segments">{formatNum(model.programs.length)}</Field>
                      {model.dynsymCount != null ? <Field label="Dynamic symbols">{formatNum(model.dynsymCount)}</Field> : null}
                      {model.soname ? <Field label="SONAME" mono>{model.soname}</Field> : null}
                    </InfoGrid>
                  </SectionCard>
                  <SectionCard title="Program headers" icon={<Layers className="h-3.5 w-3.5" />}>
                    {model.programs.length ? (
                      <div className="max-h-72 overflow-auto scrollbar-thin">
                        <table className="w-full text-left text-xs">
                          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                            <tr><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 font-medium">Flags</th><th className="py-1 pr-2 font-medium">vaddr</th><th className="py-1 text-right font-medium">File size</th></tr>
                          </thead>
                          <tbody>
                            {model.programs.map((p, i) => (
                              <tr key={i} className="border-t border-zinc-800/60">
                                <td className="py-1 pr-2 text-zinc-300">{p.type}</td>
                                <td className={cn("py-1 pr-2 font-mono", p.flags.includes("X") ? "text-amber-300" : "text-zinc-400")}>{p.flags}</td>
                                <td className="py-1 pr-2 font-mono text-[10px] text-zinc-500">{p.vaddr}</td>
                                <td className="py-1 text-right tabular-nums text-zinc-400">{formatBytes(p.filesz)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <EmptyHint>No program headers.</EmptyHint>}
                  </SectionCard>
                </div>
              ) : null}
              {model.kind === "macho" ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title="Mach-O identity" icon={<Cpu className="h-3.5 w-3.5" />}>
                    <InfoGrid>
                      <Field label="Bits">{model.bits === 64 ? "64-bit" : "32-bit"}</Field>
                      <Field label="Endianness">{model.endian}</Field>
                      <Field label="CPU">{model.cpu}</Field>
                      <Field label="File type">{model.filetype}</Field>
                      {model.uuid ? <Field label="UUID" mono>{model.uuid}</Field> : null}
                      {model.platform ? <Field label="Platform">{model.platform} ≥ {model.minos}</Field> : null}
                      {model.entry ? <Field label="Entry" mono>{model.entry}</Field> : null}
                      <Field label="Flags" mono>{model.flags}</Field>
                      <Field label="Load commands">{formatNum(model.commands.length)}</Field>
                    </InfoGrid>
                  </SectionCard>
                  <SectionCard title="Load commands" icon={<Layers className="h-3.5 w-3.5" />}>
                    <div className="max-h-72 space-y-1 overflow-auto scrollbar-thin">
                      {model.commands.slice(0, 80).map((c, i) => (
                        <div key={i} className="flex items-baseline gap-2 border-b border-zinc-800/40 py-1 text-[11px]">
                          <span className="w-36 shrink-0 truncate font-mono text-emerald-300/80">{c.name}</span>
                          <span className="w-14 shrink-0 text-right tabular-nums text-zinc-600">{c.size} B</span>
                          <span className="min-w-0 truncate text-zinc-400">{c.detail}</span>
                        </div>
                      ))}
                      {model.commands.length > 80 ? <EmptyHint>… {formatNum(model.commands.length - 80)} more commands</EmptyHint> : null}
                    </div>
                  </SectionCard>
                </div>
              ) : null}
              {model.kind === "fat" ? (
                <SectionCard title="Universal binary architectures" icon={<Boxes className="h-3.5 w-3.5" />}>
                  {model.arches.length ? (
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr><th className="py-1 pr-2 font-medium">Architecture</th><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 font-medium">Offset</th><th className="py-1 text-right font-medium">Size</th></tr>
                      </thead>
                      <tbody>
                        {model.arches.map((a, i) => (
                          <tr key={i} className="border-t border-zinc-800/60">
                            <td className="py-1 pr-2 text-zinc-200">{a.cpu}</td>
                            <td className="py-1 pr-2 text-zinc-400">{a.filetype}</td>
                            <td className="py-1 pr-2 font-mono text-[10px] text-zinc-500">{a.offset}</td>
                            <td className="py-1 text-right tabular-nums text-zinc-400">{formatBytes(a.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <EmptyHint>No architectures listed.</EmptyHint>}
                  <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
                    A “fat” / universal Mach-O contains one Mach-O image per architecture — each slice can be extracted and inspected separately.
                  </p>
                </SectionCard>
              ) : null}
            </>
          ) : null}

          {panel === "sections" ? (
            <SectionCard
              title={model.kind === "macho" ? "Segments" : model.kind === "elf" ? "Sections" : "Sections & entropy"}
              icon={<Binary className="h-3.5 w-3.5" />}
              right={
                model.kind === "pe" && model.sections.some((s) => s.entropy != null && s.entropy > 7) ? (
                  <Chip tone="amber">high-entropy sections — likely packed/encrypted</Chip>
                ) : undefined
              }
            >
              {model.kind === "pe" ? (
                model.sections.length ? (
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Name</th>
                          <th className="py-1 pr-2 text-right font-medium">Virtual</th>
                          <th className="py-1 pr-2 text-right font-medium">Raw</th>
                          <th className="py-1 pr-2 font-medium">Entropy</th>
                          <th className="py-1 font-medium">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.sections.map((s) => (
                          <tr key={s.name} className={cn("border-t border-zinc-800/60", s.entropy != null && s.entropy > 7 && "bg-amber-950/20")}>
                            <td className="py-1.5 pr-2 font-mono text-zinc-200">{s.name}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.vsize)}</td>
                            <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.rawSize)}</td>
                            <td className="py-1.5 pr-2">{s.entropy != null ? <EntropyBar value={s.entropy} /> : <span className="text-zinc-600">—</span>}</td>
                            <td className="py-1.5">
                              <div className="flex flex-wrap gap-1">
                                {s.flags.map((f) => (
                                  <Chip key={f} tone={f === "X" || f === "W" ? "amber" : "zinc"}>{f}</Chip>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyHint>No section table (headerless / packed image).</EmptyHint>
              ) : null}
              {model.kind === "elf" ? (
                model.sections.length ? (
                  <div className="max-h-[60vh] overflow-auto scrollbar-thin">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-500">
                        <tr>
                          <th className="py-1 pr-2 font-medium">Name</th>
                          <th className="py-1 pr-2 font-medium">Type</th>
                          <th className="py-1 pr-2 text-right font-medium">Size</th>
                          <th className="py-1 font-medium">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.sections.map((s, i) => (
                          <tr key={i} className="border-t border-zinc-800/60">
                            <td className="py-1 pr-2 font-mono text-zinc-200">{s.name}</td>
                            <td className="py-1 pr-2 text-zinc-400">{s.type}</td>
                            <td className="py-1 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.size)}</td>
                            <td className="py-1 font-mono text-zinc-400">{s.flags.join("") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyHint>No section headers present.</EmptyHint>
              ) : null}
              {model.kind === "macho" ? (
                model.segments.length ? (
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Segment</th>
                        <th className="py-1 pr-2 text-right font-medium">VM size</th>
                        <th className="py-1 pr-2 text-right font-medium">File size</th>
                        <th className="py-1 pr-2 font-medium">File offset</th>
                        <th className="py-1 text-right font-medium">Sections</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.segments.map((s) => (
                        <tr key={s.name} className="border-t border-zinc-800/60">
                          <td className="py-1.5 pr-2 font-mono text-zinc-200">{s.name}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.vmsize)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-zinc-400">{formatBytes(s.filesize)}</td>
                          <td className="py-1.5 pr-2 font-mono text-[10px] text-zinc-500">{hexv(s.fileoff)}</td>
                          <td className="py-1.5 text-right tabular-nums text-zinc-400">{s.nsects}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <EmptyHint>No LC_SEGMENT commands.</EmptyHint>
              ) : null}
              {model.kind === "fat" ? <EmptyHint>Per-architecture segments are not expanded for fat binaries — see Summary for the architecture table.</EmptyHint> : null}
            </SectionCard>
          ) : null}

          {panel === "imports" ? (
            <SectionCard
              title={model.kind === "elf" ? "Dynamic libraries (DT_NEEDED)" : model.kind === "macho" ? "Linked dylibs" : "Import table"}
              icon={<Import className="h-3.5 w-3.5" />}
            >
              {model.kind === "pe" ? (
                model.imports.length ? (
                  <div className="space-y-3">
                    {model.imports.map((imp) => (
                      <div key={imp.dll} className="rounded border border-zinc-800 bg-zinc-950/40 p-2.5">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-emerald-300">{imp.dll}</span>
                          <Chip tone="teal">{formatNum(imp.count)} functions</Chip>
                        </div>
                        {imp.names.length ? (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
                            {imp.names.map((n, i) => <span key={i}>{n}</span>)}
                            {imp.count > imp.names.length ? <span className="text-zinc-600">+{formatNum(imp.count - imp.names.length)} more…</span> : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : <EmptyHint>No import data available in this image.</EmptyHint>
              ) : null}
              {model.kind === "elf" ? (
                <>
                  {model.needed.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {model.needed.map((n) => <Chip key={n} tone="emerald">{n}</Chip>)}
                    </div>
                  ) : <EmptyHint>No DT_NEEDED entries — statically linked or not fully parsed.</EmptyHint>}
                  {model.dynsymCount != null ? (
                    <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] text-zinc-500">
                      Dynamic symbol table exposes {formatNum(model.dynsymCount)} symbols{model.soname ? ` · SONAME ${model.soname}` : ""}.
                    </p>
                  ) : null}
                </>
              ) : null}
              {model.kind === "macho" ? (
                model.dylibs.length ? (
                  <div className="space-y-1.5">
                    {model.dylibs.map((d, i) => (
                      <div key={i} className="flex flex-wrap items-baseline gap-2 border-b border-zinc-800/40 pb-1.5 text-xs">
                        <span className="font-mono text-emerald-300">{d.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{d.kind}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyHint>No dylib load commands.</EmptyHint>
              ) : null}
              {model.kind === "fat" ? <EmptyHint>Imports are per-architecture — not expanded for fat binaries.</EmptyHint> : null}
            </SectionCard>
          ) : null}

          {model.notes.length ? <NotesStrip notes={model.notes} /> : null}
          {!arrayBuffer ? (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-[11px] leading-relaxed text-zinc-500">
              Parsed from the first 64 KB only (file exceeds the in-memory load cap) — header data is complete, but section bodies,
              entropy and import tables may be truncated.
            </div>
          ) : null}
        </div>
      </ViewerBody>
      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Binary className="h-3.5 w-3.5" />
        <span className="truncate">{detected.name} · {formatBytes(file.size)} · {fileName}</span>
      </div>
    </div>
  );
}
