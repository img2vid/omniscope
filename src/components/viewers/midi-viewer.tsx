"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ErrorCard, LoadingState, Chip, Segmented, SectionCard, InfoGrid, Field, EmptyHint } from "./viewer-ui";
import { formatDuration, formatNum, decodeWith, clamp, accentSolid, observeAccent } from "@/lib/utils";
import { Gauge, ListMusic, Music, Pause, Play, SkipBack, Square } from "lucide-react";

/* ------------------------------ SMF parser ------------------------------ */

export interface MidiNote {
  track: number;
  channel: number;
  note: number;
  vel: number;
  start: number;
  dur: number;
}

export interface MidiTrackInfo {
  index: number;
  name: string;
  noteCount: number;
  programs: number[];
  channels: number[];
}

export interface TempoEntry {
  tick: number;
  sec: number;
  uspq: number;
  bpm: number;
}

export interface MidiEventRow {
  tick: number;
  sec: number;
  track: number;
  kind: string;
  info: string;
}

export interface MidiData {
  format: number;
  ntrks: number;
  tpq: number;
  smpte: { fps: number; tpf: number } | null;
  tracks: MidiTrackInfo[];
  notes: MidiNote[];
  tempos: TempoEntry[];
  timeSig: string | null;
  duration: number;
  events: MidiEventRow[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteName(n: number): string {
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

const GM_PROGRAMS: string[] = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-Tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass", "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2", "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)", "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass+lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)", "Pad 5 (bow)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)", "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Tom-Tom", "Melodic Tom", "Synth Drum",
  "Reverse Cymbal", "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause",
  "Gunshot",
];

function readVarLen(bytes: Uint8Array, o: number): [number, number] {
  let v = 0;
  let n = 0;
  while (o + n < bytes.length && n < 5) {
    const x = bytes[o + n];
    n++;
    v = (v << 7) | (x & 0x7f);
    if (!(x & 0x80)) break;
  }
  return [v, o + n];
}

export function parseMidi(bytes: Uint8Array): MidiData {
  if (bytes.length < 14) throw new Error("File too short to contain a MIDI header.");
  if (bytes[0] !== 0x4d || bytes[1] !== 0x54 || bytes[2] !== 0x68 || bytes[3] !== 0x64) {
    throw new Error("Missing MThd chunk — not a Standard MIDI File.");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = dv.getUint32(4, false);
  const format = dv.getUint16(8, false);
  const ntrks = dv.getUint16(10, false);
  const division = dv.getUint16(12, false);
  let p = 8 + headerLen;

  const smpte = (division & 0x8000) !== 0 ? { fps: 0x100 - (division >> 8), tpf: division & 0xff } : null;
  const tpq = smpte ? 0 : Math.max(1, division);

  interface RawNote { track: number; channel: number; note: number; vel: number; startTick: number; endTick: number; }
  const rawNotes: RawNote[] = [];
  const tempoRaw: { tick: number; uspq: number }[] = [{ tick: 0, uspq: 500000 }];
  const tracks: MidiTrackInfo[] = [];
  const events: MidiEventRow[] = [];
  let maxTick = 0;
  let timeSig: string | null = null;

  let trackIndex = 0;
  while (p + 8 <= bytes.length && trackIndex < ntrks) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const len = dv.getUint32(p + 4, false);
    const start = p + 8;
    const end = Math.min(start + len, bytes.length);
    p = end;
    if (id !== "MTrk") continue;

    const info: MidiTrackInfo = { index: trackIndex, name: "", noteCount: 0, programs: [], channels: [] };
    const channelsSeen = new Set<number>();
    const programsByChannel = new Map<number, number>();
    const trackNoteCount = { n: 0 };
    let q = start;
    let tick = 0;
    let running = 0;

    const open = new Map<number, { vel: number; startTick: number }[]>();
    const closeNote = (channel: number, nn: number, endTick: number) => {
      const key = channel * 128 + nn;
      const stack = open.get(key);
      if (stack && stack.length) {
        const st = stack.pop()!;
        if (!stack.length) open.delete(key);
        rawNotes.push({
          track: trackIndex,
          channel,
          note: nn,
          vel: st.vel,
          startTick: st.startTick,
          endTick: Math.max(endTick, st.startTick),
        });
        trackNoteCount.n++;
      }
    };
    const pushEvent = (kind: string, info2: string) => {
      if (events.length < 300) events.push({ tick, sec: 0, track: trackIndex, kind, info: info2 });
    };

    while (q < end) {
      const [delta, nq] = readVarLen(bytes, q);
      q = nq;
      tick += delta;
      let status = bytes[q];
      if (status === undefined) break;
      if (status < 0x80) {
        if (!running) break;
        status = running;
      } else {
        q++;
        running = status < 0xf0 ? status : 0;
      }
      const hi = status & 0xf0;
      const ch = status & 0x0f;

      if (hi === 0x90) {
        const nn = bytes[q++];
        const vel = bytes[q++];
        channelsSeen.add(ch);
        if (vel > 0) {
          const key = ch * 128 + nn;
          let stack = open.get(key);
          if (!stack) {
            stack = [];
            open.set(key, stack);
          }
          stack.push({ vel, startTick: tick });
          pushEvent("Note On", `${noteName(nn)} vel ${vel} · ch ${ch + 1}`);
        } else {
          closeNote(ch, nn, tick);
          pushEvent("Note Off", noteName(nn));
        }
      } else if (hi === 0x80) {
        const nn = bytes[q++];
        const vel = bytes[q++];
        closeNote(ch, nn, tick);
        pushEvent("Note Off", `${noteName(nn)}${vel ? ` vel ${vel}` : ""}`);
      } else if (hi === 0xa0) {
        const nn = bytes[q++];
        const pressure = bytes[q++];
        pushEvent("Aftertouch", `${noteName(nn)} ${pressure}`);
      } else if (hi === 0xb0) {
        const cc = bytes[q++];
        const val = bytes[q++];
        channelsSeen.add(ch);
        const known: Record<number, string> = { 1: "modulation", 7: "volume", 10: "pan", 11: "expression", 64: "sustain", 91: "reverb" };
        pushEvent("Control", `CC${cc} = ${val}${known[cc] ? ` (${known[cc]})` : ""} · ch ${ch + 1}`);
      } else if (hi === 0xc0) {
        const prog = bytes[q++];
        channelsSeen.add(ch);
        programsByChannel.set(ch, prog);
        pushEvent("Program", `${GM_PROGRAMS[prog] ?? `Program ${prog}`} · ch ${ch + 1}`);
      } else if (hi === 0xd0) {
        const pressure = bytes[q++];
        pushEvent("Channel AT", String(pressure));
      } else if (hi === 0xe0) {
        const lsb = bytes[q++];
        const msb = bytes[q++];
        pushEvent("Pitch Bend", String(((msb << 7) | lsb) - 8192));
      } else if (status === 0xff) {
        const type = bytes[q++];
        const [len2, nq2] = readVarLen(bytes, q);
        q = nq2;
        const dataEnd = Math.min(q + len2, end);
        const data = bytes.subarray(q, Math.min(q, dataEnd));
        q = dataEnd;
        const text = data.length ? decodeWith(data, "utf-8").trim() : "";
        if (type === 0x51 && data.length >= 3) {
          const uspq = (data[0] << 16) | (data[1] << 8) | data[2];
          if (uspq > 0) tempoRaw.push({ tick, uspq });
          pushEvent("Tempo", `${(60000000 / uspq).toFixed(2)} bpm`);
        } else if (type === 0x03) {
          if (!info.name) info.name = text;
          pushEvent("Track Name", text);
        } else if (type === 0x58 && data.length >= 2) {
          timeSig = `${data[0]}/${2 ** data[1]}`;
          pushEvent("Time Sig", timeSig);
        } else if (type === 0x2f) {
          pushEvent("End of Track", "");
          break;
        } else if (type === 0x06) {
          pushEvent("Marker", text);
        } else if (type === 0x01) {
          pushEvent("Text", text);
        } else if (type === 0x02) {
          pushEvent("Copyright", text);
        } else if (type === 0x21) {
          pushEvent("Port", String(data[0] ?? 0));
        }
      } else if (status === 0xf0 || status === 0xf7) {
        const [len2, nq2] = readVarLen(bytes, q);
        q = Math.min(nq2 + len2, end);
        pushEvent("SysEx", `${len2} bytes`);
      } else {
        q++;
      }
      if (tick > maxTick) maxTick = tick;
    }
    // flush still-open notes at the last known tick of the track
    for (const [key, stack] of Array.from(open.entries())) {
      while (stack.length) {
        const st = stack.pop()!;
        rawNotes.push({
          track: trackIndex,
          channel: Math.floor(key / 128),
          note: key % 128,
          vel: st.vel,
          startTick: st.startTick,
          endTick: Math.max(tick, st.startTick),
        });
        trackNoteCount.n++;
      }
    }
    info.noteCount = trackNoteCount.n;
    info.channels = Array.from(channelsSeen).sort((a, b) => a - b);
    info.programs = Array.from(new Set(programsByChannel.values())).sort((a, b) => a - b);
    tracks.push(info);
    trackIndex++;
  }

  // tempo → absolute seconds
  tempoRaw.sort((a, b) => a.tick - b.tick);
  const tempos: TempoEntry[] = [];
  if (!smpte) {
    let accSec = 0;
    let lastTick = 0;
    let lastUspq = 500000;
    for (const t of tempoRaw) {
      if (t.tick < lastTick) continue;
      accSec += ((t.tick - lastTick) * lastUspq) / (1e6 * tpq);
      tempos.push({ tick: t.tick, sec: accSec, uspq: t.uspq, bpm: 60000000 / t.uspq });
      lastTick = t.tick;
      lastUspq = t.uspq;
    }
  } else {
    for (const t of tempoRaw) {
      tempos.push({ tick: t.tick, sec: t.tick / (smpte.fps * smpte.tpf), uspq: t.uspq, bpm: 60000000 / t.uspq });
    }
  }

  const tickToSec = (tick: number): number => {
    if (smpte) return tick / (smpte.fps * smpte.tpf);
    let lo = 0;
    let hi = tempos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tempos[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    const t = tempos[lo];
    return t.sec + ((tick - t.tick) * t.uspq) / (1e6 * tpq);
  };

  const notes: MidiNote[] = rawNotes
    .map((n) => {
      const start = tickToSec(n.startTick);
      return { track: n.track, channel: n.channel, note: n.note, vel: n.vel, start, dur: Math.max(tickToSec(n.endTick) - start, 0.04) };
    })
    .sort((a, b) => a.start - b.start);
  for (const ev of events) ev.sec = tickToSec(ev.tick);

  const duration = Math.max(notes.length ? notes[notes.length - 1].start + notes[notes.length - 1].dur : 0, tickToSec(maxTick));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("No usable timing information found.");

  return { format, ntrks, tpq, smpte, tracks, notes, tempos, timeSig, duration, events };
}

/* ------------------------------ synth ------------------------------ */

interface Timbre {
  types: OscillatorType[];
  detune: number;
  filter?: number;
  gain: number;
  attack: number;
  release: number;
}

/** Rough general-MIDI-family timbre mapping (no samples — pure WebAudio). */
function timbreFor(program: number): Timbre {
  const p = ((program % 128) + 128) % 128;
  if (p < 8) return { types: ["triangle", "sine"], detune: 2, gain: 1.0, attack: 0.004, release: 0.14 };
  if (p < 16) return { types: ["sine", "triangle"], detune: 3, gain: 0.8, attack: 0.003, release: 0.12 };
  if (p < 24) return { types: ["sine", "sine"], detune: 7, gain: 0.75, attack: 0.02, release: 0.1 };
  if (p < 32) return { types: ["sawtooth", "triangle"], detune: 4, filter: 2400, gain: 0.55, attack: 0.008, release: 0.18 };
  if (p < 40) return { types: ["triangle", "sawtooth"], detune: 0, filter: 700, gain: 0.7, attack: 0.01, release: 0.12 };
  if (p < 48) return { types: ["sawtooth", "sawtooth"], detune: 8, filter: 1500, gain: 0.35, attack: 0.06, release: 0.3 };
  if (p < 56) return { types: ["sawtooth", "sawtooth"], detune: 9, filter: 1300, gain: 0.32, attack: 0.1, release: 0.35 };
  if (p < 64) return { types: ["sawtooth", "square"], detune: 6, filter: 2000, gain: 0.4, attack: 0.05, release: 0.2 };
  if (p < 72) return { types: ["square"], detune: 0, filter: 2600, gain: 0.32, attack: 0.03, release: 0.15 };
  if (p < 80) return { types: ["sine", "sine"], detune: 5, gain: 0.7, attack: 0.03, release: 0.15 };
  if (p < 88) return { types: ["square", "sawtooth"], detune: 5, filter: 3200, gain: 0.35, attack: 0.01, release: 0.2 };
  if (p < 96) return { types: ["sawtooth", "sawtooth"], detune: 12, filter: 1100, gain: 0.3, attack: 0.25, release: 0.6 };
  if (p < 104) return { types: ["triangle", "sine"], detune: 20, filter: 3000, gain: 0.4, attack: 0.05, release: 0.4 };
  if (p < 112) return { types: ["triangle", "sine"], detune: 4, gain: 0.7, attack: 0.01, release: 0.2 };
  if (p < 120) return { types: ["square", "triangle"], detune: 3, filter: 2800, gain: 0.4, attack: 0.002, release: 0.08 };
  return { types: ["sawtooth", "sine"], detune: 30, gain: 0.35, attack: 0.01, release: 0.3 };
}

const TRACK_COLORS = ["#34d399", "#f59e0b", "#fb7185", "#c084fc", "#2dd4bf", "#f97316"];

/** track 0 carries the brand accent (follows the accent picker); other tracks keep distinct hues */
function trackColor(i: number): string {
  const slot = ((i % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length;
  return slot === 0 ? accentSolid(400, TRACK_COLORS[0]) : TRACK_COLORS[slot];
}

/* ------------------------------ component ------------------------------ */

const GUTTER = 52;
const ROW_H = 14;
const MAX_EVENTS = 300;

interface PlayerState {
  ctx: AudioContext;
  master: GainNode;
  sources: OscillatorNode[];
  t0: number;
  offset: number;
}

export default function MidiViewer({ file, arrayBuffer, head, detected, fileName }: ViewerProps) {
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [data, setData] = React.useState<MidiData | null>(null);
  const [panel, setPanel] = React.useState<"roll" | "events" | "info">("roll");
  const [playing, setPlaying] = React.useState(false);
  const [seekSec, setSeekSec] = React.useState(0);

  const playerRef = React.useRef<PlayerState | null>(null);
  const rafRef = React.useRef(0);
  const currentSecRef = React.useRef(0);
  const timeLabelRef = React.useRef<HTMLSpanElement | null>(null);
  const rollCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rollWrapRef = React.useRef<HTMLDivElement | null>(null);
  const drawRef = React.useRef<(() => void) | null>(null);

  /* ---------- parse ---------- */
  React.useEffect(() => {
    if (!arrayBuffer) {
      setPhase("error");
      setErrorMsg("This file exceeds the in-browser load cap (96 MB). MIDI parsing needs the full buffer.");
      return;
    }
    try {
      const midi = parseMidi(new Uint8Array(arrayBuffer));
      setData(midi);
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [arrayBuffer]);

  const nowSec = React.useCallback((): number => {
    const pl = playerRef.current;
    if (pl) {
      const cur = pl.offset + (pl.ctx.currentTime - pl.t0);
      return cur < pl.offset ? pl.offset : cur;
    }
    return currentSecRef.current;
  }, []);

  /* ---------- piano roll drawing ---------- */
  const draw = React.useCallback(() => {
    const midi = data;
    const c = rollCanvasRef.current;
    const wrap = rollWrapRef.current;
    if (!midi || !c || !wrap || panel !== "roll") return;
    const notes = midi.notes;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let lo = 127;
    let hi = 0;
    if (notes.length) {
      for (const n of notes) {
        if (n.note < lo) lo = n.note;
        if (n.note > hi) hi = n.note;
      }
      lo = Math.max(0, lo - 2);
      hi = Math.min(127, hi + 2);
      if (hi - lo < 23) {
        const mid = (lo + hi) / 2;
        lo = clamp(Math.round(mid - 11), 0, 104);
        hi = Math.min(127, lo + 23);
      }
    } else {
      lo = 36;
      hi = 84;
    }
    const rows = hi - lo + 1;
    const cssW = Math.max(320, wrap.clientWidth);
    const cssH = rows * ROW_H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wPx = Math.round(cssW * dpr);
    const hPx = Math.round(cssH * dpr);
    if (c.width !== wPx) c.width = wPx;
    if (c.height !== hPx) c.height = hPx;
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, cssW, cssH);

    const plotW = cssW - GUTTER;
    const dur = Math.max(midi.duration, 0.001);

    // row backgrounds (dark keys slightly darker)
    for (let n = lo; n <= hi; n++) {
      const y = (hi - n) * ROW_H;
      const black = [1, 3, 6, 8, 10].includes(n % 12);
      ctx.fillStyle = black ? "#111114" : "#0c0c0e";
      ctx.fillRect(GUTTER, y, plotW, ROW_H);
    }
    ctx.strokeStyle = "#1c1c20";
    ctx.lineWidth = 1;
    for (let r = 0; r <= rows; r++) {
      const y = r * ROW_H + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
    }

    // key gutter
    ctx.font = "9px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    for (let n = lo; n <= hi; n++) {
      const y = (hi - n) * ROW_H;
      const black = [1, 3, 6, 8, 10].includes(n % 12);
      if (black) {
        ctx.fillStyle = "#18181b";
        ctx.fillRect(0, y + 0.5, 32, ROW_H - 1);
      } else {
        ctx.fillStyle = "#d4d4d8";
        ctx.fillRect(0, y + 0.5, GUTTER - 8, ROW_H - 1);
        if (n % 12 === 0) {
          ctx.fillStyle = "#3f3f46";
          ctx.fillText(`C${Math.floor(n / 12) - 1}`, GUTTER - 26, y + ROW_H / 2);
        }
      }
    }

    // notes
    const playhead = nowSec();
    for (const note of notes) {
      if (note.note < lo || note.note > hi) continue;
      const x = GUTTER + (note.start / dur) * plotW;
      const w = Math.max(2, (note.dur / dur) * plotW - 0.5);
      const y = (hi - note.note) * ROW_H + 1.5;
      const h = ROW_H - 3;
      const active = playing && playhead >= note.start && playhead < note.start + note.dur;
      ctx.fillStyle = active ? "#fbbf24" : trackColor(note.track);
      ctx.globalAlpha = active ? 1 : 0.88;
      ctx.fillRect(x, y, w, h);
      if (active) {
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      }
    }
    ctx.globalAlpha = 1;

    // playhead
    const ph = GUTTER + clamp(playhead / dur, 0, 1) * plotW;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ph, 0);
    ctx.lineTo(ph, cssH);
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(ph - 4, 0);
    ctx.lineTo(ph + 4, 0);
    ctx.lineTo(ph, 6);
    ctx.closePath();
    ctx.fill();
  }, [data, panel, playing, nowSec]);

  React.useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  /* accent picker changes recolor track 0 live (canvas + legend chips) */
  const [, setAccentTick] = React.useState(0);
  React.useEffect(
    () =>
      observeAccent(() => {
        setAccentTick((t) => t + 1);
        drawRef.current?.();
      }),
    [],
  );

  /* ---------- playback ---------- */
  const stopAll = React.useCallback(() => {
    const pl = playerRef.current;
    if (pl) {
      for (const s of pl.sources) {
        try {
          s.stop(0);
        } catch {
          /* already stopped */
        }
      }
      try {
        pl.master.disconnect();
      } catch {
        /* ignore */
      }
      try {
        void pl.ctx.close();
      } catch {
        /* ignore */
      }
    }
    playerRef.current = null;
  }, []);

  const scheduleNote = (ctx: AudioContext, dest: AudioNode, note: MidiNote, program: number, when: number, dur: number): OscillatorNode[] => {
    const timbre = timbreFor(program);
    const freq = 440 * Math.pow(2, (note.note - 69) / 12);
    const env = ctx.createGain();
    env.gain.value = 0;
    let out: AudioNode = env;
    if (timbre.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.max(300, timbre.filter);
      filter.Q.value = 0.7;
      env.connect(filter);
      out = filter;
    }
    out.connect(dest);
    const peak = Math.max(0.02, (note.vel / 127) * timbre.gain * 0.5);
    const attack = Math.min(timbre.attack, Math.max(dur * 0.4, 0.002));
    const release = timbre.release;
    const end = when + Math.max(dur, 0.06);
    const decayEnd = Math.max(when + attack + 0.01, end);
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(peak, when + attack);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * 0.5, 0.001), decayEnd);
    env.gain.exponentialRampToValueAtTime(0.0008, decayEnd + release);
    const oscs: OscillatorNode[] = [];
    timbre.types.forEach((type, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = timbre.detune * (i === 0 ? -0.5 : 0.5);
      osc.connect(env);
      osc.start(when);
      osc.stop(decayEnd + release + 0.05);
      oscs.push(osc);
    });
    return oscs;
  };

  const startPlayback = React.useCallback(
    (offset: number) => {
      const midi = data;
      if (!midi || midi.notes.length === 0) return;
      const AC = window.AudioContext;
      if (!AC) return;
      stopAll();
      try {
        const ctx = new AC();
        const master = ctx.createGain();
        master.gain.value = 0.35;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 6;
        master.connect(comp);
        comp.connect(ctx.destination);
        const t0 = ctx.currentTime + 0.08;
        const sources: OscillatorNode[] = [];
        for (const note of midi.notes) {
          const noteEnd = note.start + note.dur;
          if (noteEnd <= offset + 0.01) continue;
          const when = note.start >= offset ? t0 + (note.start - offset) : t0;
          const dur = note.start >= offset ? note.dur : noteEnd - offset;
          if (dur < 0.015) continue;
          const track = midi.tracks[note.track];
          const program = track?.programs?.length ? track.programs[0] : 0;
          sources.push(...scheduleNote(ctx, master, note, program, when, dur));
        }
        playerRef.current = { ctx, master, sources, t0, offset };
        currentSecRef.current = offset;
        setPlaying(true);
      } catch {
        stopAll();
      }
    },
    [data, stopAll],
  );

  const seekTo = React.useCallback(
    (sec: number) => {
      const midi = data;
      if (!midi) return;
      const target = clamp(sec, 0, midi.duration);
      setSeekSec(target);
      currentSecRef.current = target;
      if (playerRef.current) {
        startPlayback(target);
      } else {
        drawRef.current?.();
        if (timeLabelRef.current) timeLabelRef.current.textContent = `${formatDuration(target)} / ${formatDuration(midi.duration)}`;
      }
    },
    [data, startPlayback],
  );

  const pausePlayback = React.useCallback(() => {
    const cur = nowSec();
    stopAll();
    setPlaying(false);
    currentSecRef.current = cur;
    setSeekSec(cur);
  }, [nowSec, stopAll]);

  const stopPlayback = React.useCallback(() => {
    stopAll();
    setPlaying(false);
    currentSecRef.current = 0;
    setSeekSec(0);
    drawRef.current?.();
    if (timeLabelRef.current && data) timeLabelRef.current.textContent = `0:00.000 / ${formatDuration(data.duration)}`;
  }, [data, stopAll]);

  const togglePlay = React.useCallback(() => {
    if (playing) {
      pausePlayback();
    } else {
      const midi = data;
      if (!midi) return;
      const from = seekSec >= midi.duration - 0.02 ? 0 : seekSec;
      startPlayback(from);
    }
  }, [playing, pausePlayback, startPlayback, data, seekSec]);

  /* ---------- rAF loop while playing ---------- */
  React.useEffect(() => {
    if (!playing || !data) return;
    const loop = () => {
      const cur = nowSec();
      currentSecRef.current = cur;
      drawRef.current?.();
      if (timeLabelRef.current) {
        timeLabelRef.current.textContent = `${formatDuration(cur)} / ${formatDuration(data.duration)}`;
      }
      if (cur >= data.duration + 0.3) {
        stopPlayback();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, data, nowSec, stopPlayback]);

  // unmount: kill audio
  React.useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      const pl = playerRef.current;
      if (pl) {
        for (const s of pl.sources) {
          try {
            s.stop(0);
          } catch {
            /* ignore */
          }
        }
        try {
          void pl.ctx.close();
        } catch {
          /* ignore */
        }
        playerRef.current = null;
      }
    };
  }, []);

  /* ---------- canvas sizing / panel switch ---------- */
  React.useEffect(() => {
    if (phase !== "ready" || panel !== "roll") return;
    const wrap = rollWrapRef.current;
    drawRef.current?.();
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current?.());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [phase, panel]);

  React.useEffect(() => {
    if (phase !== "ready" || !data) return;
    if (timeLabelRef.current) timeLabelRef.current.textContent = `${formatDuration(currentSecRef.current)} / ${formatDuration(data.duration)}`;
  }, [phase, data, seekSec]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const midi = data;
    const c = rollCanvasRef.current;
    if (!midi || !c) return;
    const rect = c.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - GUTTER);
    const sec = clamp((e.clientX - rect.left - GUTTER) / plotW, 0, 1) * midi.duration;
    seekTo(sec);
  };

  /* ---------- render ---------- */

  const firstTempo = data?.tempos.find((t) => t.uspq !== 500000) ?? data?.tempos[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">
              <Music className="h-3 w-3" />
              MIDI
            </Chip>
            {data ? (
              <>
                <Chip>fmt {data.format}</Chip>
                <Chip>{formatDuration(data.duration)}</Chip>
                <Chip>{formatNum(data.notes.length)} notes</Chip>
                <Chip>{data.tracks.length} tracks</Chip>
                {firstTempo ? (
                  <Chip tone="amber">
                    <Gauge className="h-3 w-3" />
                    {data.tempos.length > 2 ? `${firstTempo.bpm.toFixed(1)}+ bpm` : `${firstTempo.bpm.toFixed(1)} bpm`}
                  </Chip>
                ) : null}
                {data.timeSig ? <Chip tone="teal">{data.timeSig}</Chip> : null}
              </>
            ) : null}
          </>
        }
        center={
          data ? (
            <div className="flex items-center gap-1.5">
              <ToolButton title="Back to start" onClick={() => seekTo(0)}>
                <SkipBack className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolButton title={playing ? "Pause" : "Play"} active={playing} onClick={togglePlay}>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </ToolButton>
              <ToolButton title="Stop" onClick={stopPlayback}>
                <Square className="h-3.5 w-3.5" />
              </ToolButton>
              <ToolbarDivider />
              <span ref={timeLabelRef} className="tabular-nums text-xs font-medium text-zinc-300">
                0:00.000 / {formatDuration(data.duration)}
              </span>
            </div>
          ) : undefined
        }
        right={
          <Segmented
            value={panel}
            onChange={setPanel}
            options={[
              { value: "roll", label: "Roll" },
              { value: "events", label: "Events" },
              { value: "info", label: "Info" },
            ]}
          />
        }
      />

      {phase === "error" ? (
        <ErrorCard
          title="MIDI parse failed"
          message={errorMsg ?? "Unknown error"}
          hint="Supports Standard MIDI Files (format 0/1/2). Click the roll to seek; playback uses WebAudio synthesis."
        />
      ) : phase === "loading" ? (
        <LoadingState label="Parsing MIDI…" />
      ) : !data ? (
        <EmptyHint>No data.</EmptyHint>
      ) : (
        <>
          {panel === "roll" ? (
            <div className="relative min-h-0 flex-1">
              <div ref={rollWrapRef} className="absolute inset-0 overflow-y-auto scrollbar-thin bg-[#09090b]">
                {data.notes.length ? (
                  <canvas ref={rollCanvasRef} className="block cursor-crosshair" onClick={onCanvasClick} />
                ) : (
                  <EmptyHint>No note events — see Events/Info tabs for metadata.</EmptyHint>
                )}
              </div>
              {data.notes.length ? (
                <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1">
                  {data.tracks.map((t) => (
                    <span
                      key={t.index}
                      className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/90 px-1.5 py-0.5 text-[10px] text-zinc-300"
                    >
                      <span className="h-2 w-2 rounded-sm" style={{ background: trackColor(t.index) }} />
                      {t.name || `Track ${t.index + 1}`}
                      <span className="text-zinc-600">{t.noteCount}♪</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {panel === "events" ? (
            <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
              <table className="w-full border-collapse text-left font-mono text-[11px]">
                <thead className="sticky top-0 z-10 bg-zinc-900/95 text-[10px] uppercase tracking-wider text-zinc-500 backdrop-blur">
                  <tr>
                    <th className="px-3 py-1.5 font-semibold">Tick</th>
                    <th className="px-3 py-1.5 font-semibold">Time</th>
                    <th className="px-3 py-1.5 font-semibold">Trk</th>
                    <th className="px-3 py-1.5 font-semibold">Event</th>
                    <th className="px-3 py-1.5 font-semibold">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.slice(0, MAX_EVENTS).map((ev, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                      <td className="px-3 py-1 text-right text-zinc-600">{formatNum(ev.tick)}</td>
                      <td className="px-3 py-1 text-zinc-400">{ev.sec.toFixed(3)}s</td>
                      <td className="px-3 py-1 text-zinc-600">{ev.track + 1}</td>
                      <td className="px-3 py-1 text-emerald-300/90">{ev.kind}</td>
                      <td className="max-w-0 truncate px-3 py-1 text-zinc-300" title={ev.info}>
                        {ev.info}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.events.length === 0 ? <EmptyHint>No events recorded.</EmptyHint> : null}
              {data.events.length >= MAX_EVENTS ? (
                <EmptyHint>Showing first {MAX_EVENTS} events of a longer stream.</EmptyHint>
              ) : null}
            </div>
          ) : null}

          {panel === "info" ? (
            <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-4">
              <div className="mx-auto grid max-w-3xl gap-4">
                <SectionCard title="File" icon={<ListMusic className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Format">{data.format === 0 ? "0 (single track)" : data.format === 1 ? "1 (synchronous)" : data.format === 2 ? "2 (asynchronous)" : data.format}</Field>
                    <Field label="Tracks">{data.ntrks} declared · {data.tracks.length} parsed</Field>
                    <Field label="Division">
                      {data.smpte ? `SMPTE ${data.smpte.fps} fps × ${data.smpte.tpf} ticks/frame` : `${data.tpq} ticks per quarter note`}
                    </Field>
                    <Field label="Duration">{formatDuration(data.duration)}</Field>
                    <Field label="Notes">{formatNum(data.notes.length)}</Field>
                    <Field label="Time signature">{data.timeSig ?? "—"}</Field>
                  </InfoGrid>
                </SectionCard>

                <SectionCard title="Tracks" icon={<Music className="h-3.5 w-3.5" />}>
                  <div className="space-y-1.5">
                    {data.tracks.map((t) => (
                      <div key={t.index} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: trackColor(t.index) }} />
                        <span className="font-mono text-zinc-500">#{t.index + 1}</span>
                        <span className="min-w-0 truncate text-zinc-200">{t.name || `Track ${t.index + 1}`}</span>
                        <Chip>{t.noteCount} notes</Chip>
                        {t.programs.slice(0, 3).map((p) => (
                          <Chip key={p} tone="teal">
                            {GM_PROGRAMS[p] ?? `Program ${p}`}
                          </Chip>
                        ))}
                        {t.channels.length ? <Chip>ch {t.channels.map((c) => c + 1).join(",")}</Chip> : null}
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Tempo map" icon={<Gauge className="h-3.5 w-3.5" />}>
                  {data.tempos.length ? (
                    <div className="space-y-1 font-mono text-[11px]">
                      {data.tempos.slice(0, 24).map((t, i) => (
                        <div key={i} className="flex gap-3">
                          <span className="w-20 text-right text-zinc-600">tick {formatNum(t.tick)}</span>
                          <span className="w-20 text-right text-zinc-500">{t.sec.toFixed(3)}s</span>
                          <span className="w-24 text-right text-emerald-300">{t.bpm.toFixed(2)} bpm</span>
                          <span className="text-zinc-700">{t.uspq} µs/qn</span>
                        </div>
                      ))}
                      {data.tempos.length > 24 ? <div className="pt-1 text-zinc-500">+ {data.tempos.length - 24} more tempo changes…</div> : null}
                    </div>
                  ) : (
                    <EmptyHint>No tempo events — using the default 120 bpm.</EmptyHint>
                  )}
                </SectionCard>
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Music className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Click the piano roll to seek · WebAudio synth (no samples) · colors per track</span>
        <span className="ml-auto hidden shrink-0 text-zinc-600 sm:inline">{fileName}</span>
      </div>
    </div>
  );
}
