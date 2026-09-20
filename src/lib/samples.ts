/** Client-side sample file factory — lets users try every viewer without their own files. */
import { zipSync, strToU8 } from "fflate";
import { accentSolid } from "./utils";

export interface SampleFile { name: string; label: string; blob: Blob; }

function b(str: string, type: string): Blob {
  return new Blob([str], { type });
}

/* -------- bencode encoder (for the torrent sample) -------- */
function benc(v: unknown): number[] {
  if (typeof v === "number") return [...strBytes(`i${v}e`)];
  if (typeof v === "string") return [...strBytes(`${v.length}:${v}`)];
  if (Array.isArray(v)) return [0x6c, ...v.flatMap(benc), 0x65];
  if (v && typeof v === "object") {
    const out: number[] = [0x64];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out.push(...benc(k), ...benc(val));
    }
    out.push(0x65);
    return out;
  }
  return [];
}
function strBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

/* -------- CP437 reverse map (for the NFO sample) -------- */
const CP437_HI = [
  "Ç","ü","é","â","ä","à","å","ç","ê","ë","è","ï","î","ì","Ä","Å","É","æ","Æ","ô","ö","ò","û","ù","ÿ","Ö","Ü","¢","£","¥","₧","ƒ",
  "á","í","ó","ú","ñ","Ñ","ª","º","¿","⌐","¬","½","¼","¡","«","»","░","▒","▓","│","┤","╡","╢","╖","╕","╣","║","╗","╝","╜","╛","┐",
  "└","┴","┬","├","─","┼","╞","╟","╚","╔","╩","╦","╠","═","╬","╧","╨","╤","╥","╙","╘","╒","╓","╫","╪","┘","┌","█","▄","▌","▐","▀",
  "α","ß","Γ","π","Σ","σ","µ","τ","Φ","Θ","Ω","δ","∞","φ","ε","∩","≡","±","≥","≤","⌠","⌡","÷","≈","°","∙","·","√","ⁿ","²","■"," ",
];
function cp437Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else {
      const idx = CP437_HI.indexOf(ch);
      out.push(idx >= 0 ? idx + 0x80 : 0x3f);
    }
  }
  return out;
}

/* -------- WAV sine -------- */
function makeWav(): Blob {
  const sr = 8000;
  const dur = 1.2;
  const n = Math.floor(sr * dur);
  const data = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 8, (dur - t) * 8);
    data[i] = Math.round(
      (Math.sin(2 * Math.PI * 440 * t) * 0.4 + Math.sin(2 * Math.PI * 880 * t) * 0.15 +
        Math.sin(2 * Math.PI * 660 * t) * 0.12) * env * 32767,
    );
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const dv = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + data.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, data.length * 2, true);
  new Int16Array(buf, 44).set(data);
  return new Blob([buf], { type: "audio/wav" });
}

/* -------- MIDI -------- */
function makeMidi(): Blob {
  const track: number[] = [];
  const push = (...b: number[]) => track.push(...b);
  // tempo 120bpm
  push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
  const notes = [60, 64, 67, 72, 71, 67, 64, 60, 62, 65, 69, 74, 72, 69, 65, 62];
  notes.forEach((nn, i) => {
    const vel = 70 + (i % 4) * 8;
    push(0x00, 0x90, nn, vel);           // note on
    push(0x60, 0x80, nn, 0x40);          // 120 ticks later, note off
  });
  push(0x00, 0xff, 0x2f, 0x00);          // end of track
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const trkHeader = [0x4d, 0x54, 0x72, 0x6b, (track.length >> 24) & 0xff, (track.length >> 16) & 0xff, (track.length >> 8) & 0xff, track.length & 0xff];
  return new Blob([new Uint8Array([...head, ...trkHeader, ...track])], { type: "audio/midi" });
}

/* -------- PNG via canvas -------- */
async function makePng(): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 200;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 320, 200);
  grad.addColorStop(0, "#052e26");
  grad.addColorStop(0.6, accentSolid(500, "#10b981"));
  grad.addColorStop(1, "#fbbf24");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 200);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.arc(160 + Math.sin(i * 1.3) * 80, 100 + Math.cos(i * 2.1) * 60, 14 + i * 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#0a0a0c";
  ctx.font = "bold 24px monospace";
  ctx.fillText("OMNISCOPE", 78, 105);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
}

export async function makeSamples(): Promise<SampleFile[]> {
  const png = await makePng();
  const zip = zipSync({
    "readme.txt": strToU8("This archive was generated inside your browser.\nNo servers were involved — 100% client-side.\n"),
    "data/hello.json": strToU8(JSON.stringify({ app: "Omniscope", clientSide: true, formats: "10000+", workers: 0 }, null, 2)),
    "data/notes.md": strToU8("# Nested file\n\nOpened from **inside** a ZIP — recursively detected.\n"),
  });
  const nfoText = [
    "░░▒▒▓▓ OMNISCOPE ASCII NFO — ENCODED IN CP437 ▓▓▒▒░░",
    "╔══════════════════════════════════════════════╗",
    "║  This NFO is stored with DOS code page 437   ║",
    "║  box-drawing characters. The viewer decodes  ║",
    "║  them to proper Unicode automatically.  ±    ║",
    "╚══════════════════════════════════════════════╝",
    "  · classic scene release notes style ·",
  ].join("\n");

  const torrent = benc({
    announce: "https://tracker.example/announce",
    "creation date": 1735689600,
    "created by": "Omniscope Sample",
    info: {
      length: 1024 * 1024,
      name: "omniscope-sample.bin",
      "piece length": 262144,
      pieces: "a".repeat(40),
    },
  });

  return [
    { name: "sample.png", label: "PNG image", blob: png },
    {
      name: "sample.svg", label: "SVG vector", blob: b(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#065f46"/><stop offset="1" stop-color="#fbbf24"/></linearGradient></defs><rect width="240" height="160" rx="12" fill="url(#g)"/><circle cx="60" cy="80" r="36" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="6"/><rect x="120" y="40" width="80" height="80" rx="8" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="6"/><text x="120" y="150" text-anchor="middle" font-family="monospace" font-size="12" fill="#0a0a0c">OMNISCOPE</text></svg>`,
        "image/svg+xml",
      ),
    },
    { name: "sample.json", label: "JSON data", blob: b(JSON.stringify({ name: "Omniscope", zeroUpload: true, viewers: ["image", "audio", "hex"], stats: { formats: "10k+", server: null } }, null, 2), "application/json") },
    { name: "sample.csv", label: "CSV table", blob: b("extension,category,viewer\npng,image,image\nflac,audio,audio\nsqlite,database,sqlite\nmid,audio,midi\nply,3d,three3d\n", "text/csv") },
    { name: "sample.wav", label: "WAV audio", blob: makeWav() },
    { name: "sample.mid", label: "MIDI music", blob: makeMidi() },
    { name: "sample.zip", label: "ZIP archive", blob: new Blob([zip as BlobPart], { type: "application/zip" }) },
    {
      name: "sample.md", label: "Markdown", blob: b(
        `# Omniscope sample\n\n**Everything** here runs client-side.\n\n- No upload\n- No tracking\n- 10,000+ format identities\n\n\`\`\`js\nconst magic = file.slice(0, 8);\n\`\`\`\n\n> Drag *your own* file anywhere on the page.\n`,
        "text/markdown",
      ),
    },
    {
      name: "sample.gpx", label: "GPS track", blob: b(
        `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Omniscope" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>Morning Loop</name><trkseg>\n<trkpt lat="52.5200" lon="13.4050"><ele>42</ele><time>2024-05-01T07:00:00Z</time></trkpt>\n<trkpt lat="52.5210" lon="13.4060"><ele>45</ele><time>2024-05-01T07:02:00Z</time></trkpt>\n<trkpt lat="52.5220" lon="13.4050"><ele>48</ele><time>2024-05-01T07:04:00Z</time></trkpt>\n<trkpt lat="52.5215" lon="13.4040"><ele>47</ele><time>2024-05-01T07:05:30Z</time></trkpt>\n<trkpt lat="52.5200" lon="13.4050"><ele>43</ele><time>2024-05-01T07:07:00Z</time></trkpt>\n</trkseg></trk>\n</gpx>`,
        "application/gpx+xml",
      ),
    },
    {
      name: "sample.pgn", label: "Chess game", blob: b(
        `[Event "Omniscope Demo"]\n[Result "1-0"]\n[White "Viewer"]\n[Black "Binary"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O f6 6. d4 exd4 7. Nxd4 c5 8. Ne2 Qxd1 9. Rxd1 Bd7 10. Nbc3 O-O-O 1-0\n`,
        "application/x-chess-pgn",
      ),
    },
    {
      name: "sample.srt", label: "Subtitles", blob: b(
        `1\n00:00:01,000 --> 00:00:03,500\nEvery format deserves a viewer.\n\n2\n00:00:04,000 --> 00:00:07,000\nEven this tiny subtitle file\ngets a timeline visualization.\n`,
        "application/x-subrip",
      ),
    },
    { name: "sample.nfo", label: "NFO (CP437)", blob: new Blob([new Uint8Array(cp437Bytes(nfoText))], { type: "text/x-nfo" }) },
    { name: "sample.torrent", label: "Torrent", blob: new Blob([new Uint8Array(torrent)], { type: "application/x-bittorrent" }) },
    { name: "sample.rtf", label: "RTF rich text", blob: b(`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Swfit;}}\\fs28 Omni\\b scope\\b0  renders \\i Rich Text Format\\i0  natively in the browser.\\par}`, "application/rtf") },
    { name: "sample.html", label: "HTML page", blob: b(`<!DOCTYPE html>\n<html><head><title>Omni</title></head>\n<body><h1>It works</h1><p>Sandboxed render, highlighted source.</p></body></html>`, "text/html") },
    {
      name: "sample.bin", label: "Unknown binary", blob: (() => {
        const n = 2048;
        const u = new Uint8Array(n);
        const hdr = new TextEncoder().encode("OMNIFMT1");
        u.set(hdr);
        let s = 123456789;
        for (let i = 8; i < n; i++) {
          s = (s * 1103515245 + 12345) & 0x7fffffff;
          u[i] = i % 256 === 0 ? 0 : (s >>> 16) & 0xff;
        }
        return new Blob([u], { type: "application/octet-stream" });
      })(),
    },
  ];
}
