"use client";

import * as React from "react";
import type { ViewerProps } from "@/lib/types";
import { ViewerToolbar, ToolButton, ToolbarDivider, ErrorCard, LoadingState, Chip, Segmented, SectionCard, InfoGrid, Field, Copyable, EmptyHint } from "./viewer-ui";
import { decodeWith } from "@/lib/utils";
import { ChevronsLeft, ChevronsRight, Crown, FlipHorizontal, Pause, Play, Swords } from "lucide-react";

/* ------------------------------ chess engine ------------------------------ */

type Color = "w" | "b";

/** board: 64 entries; index = rank*8 + file; rank 0 = "1" (white home). Piece = "wP"… */
interface Pos {
  board: (string | null)[];
  turn: Color;
  castling: string;
  ep: number;
  half: number;
  full: number;
}

interface Move {
  from: number;
  to: number;
  piece: string;
  capture: boolean;
  promo: string | null;
  castle: "K" | "Q" | null;
  ep: boolean;
}

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const GLYPHS: Record<string, string> = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟",
};

const KNIGHT_DELTAS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_DELTAS: [number, number][] = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

function algebraicToIndex(s: string): number {
  const f = s.charCodeAt(0) - 97;
  const r = parseInt(s[1], 10) - 1;
  return r * 8 + f;
}

function indexToAlgebraic(i: number): string {
  return `${String.fromCharCode(97 + (i % 8))}${Math.floor(i / 8) + 1}`;
}

function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}

export function parseFen(fen: string): Pos | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const board: (string | null)[] = new Array(64).fill(null);
  let rank = 7; // FEN starts with rank 8
  let file = 0;
  for (const ch of parts[0]) {
    if (ch === "/") {
      rank--;
      file = 0;
      if (rank < 0) return null;
      continue;
    }
    if (/[1-8]/.test(ch)) {
      file += parseInt(ch, 10);
      if (file > 8) return null;
    } else if (/[pnbrqkPNBRQK]/.test(ch)) {
      if (file > 7) return null;
      board[rank * 8 + file] = (ch === ch.toUpperCase() ? "w" : "b") + ch.toUpperCase();
      file++;
    } else {
      return null;
    }
  }
  if (rank !== 0 || file !== 8) return null;
  const turn: Color = parts[1] === "b" ? "b" : "w";
  const castling = parts[2] && parts[2] !== "-" ? parts[2].replace(/[^KQkq]/g, "") : "";
  const ep = parts[3] && parts[3] !== "-" && /^[a-h][1-8]$/.test(parts[3]) ? algebraicToIndex(parts[3]) : -1;
  const half = parts[4] && /^\d+$/.test(parts[4]) ? parseInt(parts[4], 10) : 0;
  const full = parts[5] && /^\d+$/.test(parts[5]) ? parseInt(parts[5], 10) : 1;
  return { board, turn, castling, ep, half, full };
}

export function toFen(pos: Pos): string {
  let placement = "";
  for (let r = 7; r >= 0; r--) {
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = pos.board[r * 8 + f];
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) {
        placement += empty;
        empty = 0;
      }
      const glyph = piece[1];
      placement += piece[0] === "w" ? glyph : glyph.toLowerCase();
    }
    if (empty) placement += empty;
    if (r > 0) placement += "/";
  }
  return `${placement} ${pos.turn} ${pos.castling || "-"} ${pos.ep >= 0 ? indexToAlgebraic(pos.ep) : "-"} ${pos.half} ${pos.full}`;
}

function isAttacked(pos: Pos, sq: number, by: Color): boolean {
  const f = sq % 8;
  const r = Math.floor(sq / 8);
  // pawns
  const dir = by === "w" ? 1 : -1;
  for (const df of [-1, 1]) {
    const tr = r - dir;
    const tf = f + df;
    if (onBoard(tf, tr) && pos.board[tr * 8 + tf] === `${by}P`) return true;
  }
  // knights
  for (const [df, dr] of KNIGHT_DELTAS) {
    const tf = f + df;
    const tr = r + dr;
    if (onBoard(tf, tr) && pos.board[tr * 8 + tf] === `${by}N`) return true;
  }
  // king
  for (const [df, dr] of KING_DELTAS) {
    const tf = f + df;
    const tr = r + dr;
    if (onBoard(tf, tr) && pos.board[tr * 8 + tf] === `${by}K`) return true;
  }
  // sliding
  const checkRay = (dirs: [number, number][], attacker: string, queen: string): boolean => {
    for (const [df, dr] of dirs) {
      let tf = f + df;
      let tr = r + dr;
      while (onBoard(tf, tr)) {
        const piece = pos.board[tr * 8 + tf];
        if (piece) {
          if (piece[0] === by && (piece[1] === attacker || piece[1] === queen)) return true;
          break;
        }
        tf += df;
        tr += dr;
      }
    }
    return false;
  };
  if (checkRay(BISHOP_DIRS, "B", "Q")) return true;
  if (checkRay(ROOK_DIRS, "R", "Q")) return true;
  return false;
}

function kingSquare(pos: Pos, color: Color): number {
  const target = `${color}K`;
  for (let i = 0; i < 64; i++) if (pos.board[i] === target) return i;
  return -1;
}

export function inCheck(pos: Pos, color: Color): boolean {
  const k = kingSquare(pos, color);
  return k >= 0 && isAttacked(pos, k, other(color));
}

function pseudoMoves(pos: Pos, from: number): Move[] {
  const piece = pos.board[from];
  if (!piece) return [];
  const color = piece[0] as Color;
  const type = piece[1];
  const f = from % 8;
  const r = Math.floor(from / 8);
  const moves: Move[] = [];
  const push = (tf: number, tr: number, opts?: Partial<Move>): void => {
    if (!onBoard(tf, tr)) return;
    const to = tr * 8 + tf;
    const target = pos.board[to];
    if (target && target[0] === color) return;
    moves.push({ from, to, piece, capture: !!target, promo: null, castle: null, ep: false, ...opts });
  };
  const addPawn = (to: number, tr: number): void => {
    const promoRank = color === "w" ? 7 : 0;
    if (tr === promoRank) {
      for (const promo of ["Q", "R", "B", "N"]) moves.push({ from, to, piece, capture: pos.board[to] !== null, promo, castle: null, ep: false });
    } else {
      moves.push({ from, to, piece, capture: pos.board[to] !== null, promo: null, castle: null, ep: false });
    }
  };

  if (type === "P") {
    const dir = color === "w" ? 1 : -1;
    const startRank = color === "w" ? 1 : 6;
    const one = r + dir;
    if (onBoard(f, one) && !pos.board[one * 8 + f]) {
      addPawn(one * 8 + f, one);
      const two = r + 2 * dir;
      if (r === startRank && !pos.board[two * 8 + f]) {
        moves.push({ from, to: two * 8 + f, piece, capture: false, promo: null, castle: null, ep: false });
      }
    }
    for (const df of [-1, 1]) {
      const tf = f + df;
      const tr = r + dir;
      if (!onBoard(tf, tr)) continue;
      const to = tr * 8 + tf;
      const target = pos.board[to];
      if (target && target[0] !== color) {
        addPawn(to, tr);
      } else if (!target && to === pos.ep) {
        moves.push({ from, to, piece, capture: true, promo: null, castle: null, ep: true });
      }
    }
  } else if (type === "N") {
    for (const [df, dr] of KNIGHT_DELTAS) push(f + df, r + dr);
  } else if (type === "K") {
    for (const [df, dr] of KING_DELTAS) push(f + df, r + dr);
    const home = color === "w" ? 0 : 7;
    const enemy = other(color);
    const kRight = color === "w" ? "K" : "k";
    const qRight = color === "w" ? "Q" : "q";
    if (r === home && f === 4 && pos.board[home * 8 + 4] === `${color}K`) {
      if (
        pos.castling.includes(kRight) &&
        pos.board[home * 8 + 5] === null &&
        pos.board[home * 8 + 6] === null &&
        pos.board[home * 8 + 7] === `${color}R` &&
        !isAttacked(pos, home * 8 + 4, enemy) &&
        !isAttacked(pos, home * 8 + 5, enemy) &&
        !isAttacked(pos, home * 8 + 6, enemy)
      ) {
        moves.push({ from, to: home * 8 + 6, piece, capture: false, promo: null, castle: "K", ep: false });
      }
      if (
        pos.castling.includes(qRight) &&
        pos.board[home * 8 + 1] === null &&
        pos.board[home * 8 + 2] === null &&
        pos.board[home * 8 + 3] === null &&
        pos.board[home * 8] === `${color}R` &&
        !isAttacked(pos, home * 8 + 4, enemy) &&
        !isAttacked(pos, home * 8 + 3, enemy) &&
        !isAttacked(pos, home * 8 + 2, enemy)
      ) {
        moves.push({ from, to: home * 8 + 2, piece, capture: false, promo: null, castle: "Q", ep: false });
      }
    }
  } else {
    const dirs = type === "B" ? BISHOP_DIRS : type === "R" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
    for (const [df, dr] of dirs) {
      let tf = f + df;
      let tr = r + dr;
      while (onBoard(tf, tr)) {
        const to = tr * 8 + tf;
        const target = pos.board[to];
        if (target) {
          if (target[0] !== color) moves.push({ from, to, piece, capture: true, promo: null, castle: null, ep: false });
          break;
        }
        moves.push({ from, to, piece, capture: false, promo: null, castle: null, ep: false });
        tf += df;
        tr += dr;
      }
    }
  }
  return moves;
}

export function makeMove(pos: Pos, move: Move): Pos {
  const board = pos.board.slice();
  const piece = board[move.from];
  if (!piece) return pos; // defensive: malformed move
  const color = piece[0] as Color;
  board[move.from] = null;
  if (move.ep) {
    const capturedSq = move.to - (color === "w" ? 8 : -8);
    board[capturedSq] = null;
  }
  board[move.to] = move.promo ? color + move.promo : piece;
  if (move.castle) {
    const home = color === "w" ? 0 : 7;
    if (move.castle === "K") {
      board[home * 8 + 7] = null;
      board[home * 8 + 5] = `${color}R`;
    } else {
      board[home * 8] = null;
      board[home * 8 + 3] = `${color}R`;
    }
  }
  let castling = pos.castling;
  if (piece === "wK") castling = castling.replace(/[KQ]/g, "");
  if (piece === "bK") castling = castling.replace(/[kq]/g, "");
  if (move.from === 0 || move.to === 0) castling = castling.replace("Q", "");
  if (move.from === 7 || move.to === 7) castling = castling.replace("K", "");
  if (move.from === 56 || move.to === 56) castling = castling.replace("q", "");
  if (move.from === 63 || move.to === 63) castling = castling.replace("k", "");
  let ep = -1;
  if (piece[1] === "P" && Math.abs(move.to - move.from) === 16) ep = (move.from + move.to) / 2;
  const half = piece[1] === "P" || move.capture ? 0 : pos.half + 1;
  const full = pos.turn === "b" ? pos.full + 1 : pos.full;
  return { board, turn: other(pos.turn), castling, ep, half, full };
}

export function legalMoves(pos: Pos): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (!piece || piece[0] !== pos.turn) continue;
    for (const move of pseudoMoves(pos, i)) {
      const next = makeMove(pos, move);
      if (!inCheck(next, pos.turn)) out.push(move);
    }
  }
  return out;
}

export function sanToMove(pos: Pos, sanRaw: string): { move: Move | null; ambiguous: boolean } {
  const san = sanRaw.replace(/[+#!?]+$/g, "").replace(/e\.p\.?$/i, "").trim();
  const all = legalMoves(pos);
  if (/^(O-O-O|0-0-0)$/.test(san)) {
    const mv = all.find((m) => m.castle === "Q");
    return { move: mv ?? null, ambiguous: false };
  }
  if (/^(O-O|0-0)$/.test(san)) {
    const mv = all.find((m) => m.castle === "K");
    return { move: mv ?? null, ambiguous: false };
  }
  const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h][1-8])(=?([QRBN]))?$/.exec(san);
  if (!m) return { move: null, ambiguous: false };
  const pieceType = m[1] ?? "P";
  const to = algebraicToIndex(m[5]);
  const fromFile = m[2] ? m[2].charCodeAt(0) - 97 : -1;
  const fromRank = m[3] ? parseInt(m[3], 10) - 1 : -1;
  const promoGiven = m[7] ?? null;
  const promoRank = pos.turn === "w" ? 7 : 0;
  const isPromoTarget = pieceType === "P" && Math.floor(to / 8) === promoRank;
  const desiredPromo = promoGiven ?? (isPromoTarget ? "Q" : null);
  const candidates = all.filter((mv) => {
    if (mv.piece[1] !== pieceType) return false;
    if (mv.to !== to) return false;
    if (fromFile >= 0 && mv.from % 8 !== fromFile) return false;
    if (fromRank >= 0 && Math.floor(mv.from / 8) !== fromRank) return false;
    return (mv.promo ?? null) === desiredPromo;
  });
  if (!candidates.length) return { move: null, ambiguous: false };
  return { move: candidates[0], ambiguous: candidates.length > 1 };
}

/* ------------------------------ PGN parsing ------------------------------ */

export interface MoveToken {
  san: string;
  move: Move | null;
  comment: string | null;
  ambiguous: boolean;
}

export interface ParsedGame {
  mode: "pgn";
  headers: Record<string, string>;
  tokens: MoveToken[];
  positions: Pos[];
  moves: (Move | null)[];
  result: string;
  invalidAtPly: number | null;
}

export interface ParsedFen {
  mode: "fen";
  pos: Pos;
  fen: string;
}

export type ChessGame = ParsedGame | ParsedFen;

const PLY_CAP = 3000;

export function parsePgn(text: string, fallbackFen?: string | null): ParsedGame {
  const lines = text.split(/\r\n|\r|\n/);
  const headers: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (Object.keys(headers).length) {
        i++;
        break;
      }
      continue;
    }
    const hm = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(line);
    if (hm) {
      headers[hm[1]] = hm[2];
      continue;
    }
    break;
  }
  const movetext = lines.slice(i).join("\n");
  const fenHeader = fallbackFen ?? headers.FEN ?? headers.Fen ?? null;
  const startPos = (fenHeader && parseFen(fenHeader)) || parseFen(START_FEN)!;

  // tokenize movetext
  const raw: { san: string; comment: string | null }[] = [];
  let result = headers.Result ?? "";
  let pendingComment: string | null = null;
  let p = 0;
  scan: while (p < movetext.length) {
    const ch = movetext[p];
    if (/\s/.test(ch)) {
      p++;
      continue;
    }
    if (ch === "{") {
      let depth = 1;
      p++;
      const start = p;
      while (p < movetext.length && depth > 0) {
        if (movetext[p] === "{") depth++;
        else if (movetext[p] === "}") {
          depth--;
          if (depth === 0) break;
        }
        p++;
      }
      const c = movetext.slice(start, p).trim();
      p++;
      pendingComment = pendingComment ? `${pendingComment} ${c}` : c;
      continue;
    }
    if (ch === "(") {
      let depth = 1;
      p++;
      while (p < movetext.length && depth > 0) {
        if (movetext[p] === "(") depth++;
        else if (movetext[p] === ")") depth--;
        p++;
      }
      continue;
    }
    if (ch === ";" || ch === "%") {
      while (p < movetext.length && movetext[p] !== "\n") p++;
      continue;
    }
    if (ch === "$") {
      while (p < movetext.length && /\d/.test(movetext[p])) p++;
      continue;
    }
    for (const res of ["1-0", "0-1", "1/2-1/2", "*"]) {
      if (movetext.startsWith(res, p)) {
        result = result || res;
        p += res.length;
        break scan;
      }
    }
    if (/\d/.test(ch)) {
      while (p < movetext.length && /[\d.]/.test(movetext[p])) p++;
      continue;
    }
    const rest = movetext.slice(p, p + 14);
    const sanMatch = /^(O-O-O|O-O|0-0-0|0-0)([+#!?]*)/.exec(rest);
    const plain = sanMatch ?? /^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=?[QRBN])?[+#!?]*)/.exec(rest);
    if (plain && plain[0]) {
      raw.push({ san: plain[0], comment: pendingComment });
      pendingComment = null;
      p += plain[0].length;
      continue;
    }
    p++;
  }
  if (pendingComment && raw.length) {
    const last = raw[raw.length - 1];
    last.comment = last.comment ? `${last.comment} ${pendingComment}` : pendingComment;
  } else if (pendingComment) {
    raw.push({ san: "", comment: pendingComment });
  }

  const tokens: MoveToken[] = [];
  const positions: Pos[] = [startPos];
  const moves: (Move | null)[] = [];
  let invalidAtPly: number | null = null;
  let pos = startPos;
  for (const tok of raw) {
    if (positions.length > PLY_CAP) break;
    if (!tok.san) {
      tokens.push({ san: "", move: null, comment: tok.comment, ambiguous: false });
      continue;
    }
    const { move, ambiguous } = sanToMove(pos, tok.san);
    tokens.push({ san: tok.san, move, comment: tok.comment, ambiguous });
    if (move) {
      pos = makeMove(pos, move);
      positions.push(pos);
      moves.push(move);
    } else {
      if (invalidAtPly === null) invalidAtPly = positions.length - 1;
      moves.push(null);
    }
  }
  return { mode: "pgn", headers, tokens, positions, moves, result: result || "*", invalidAtPly };
}

/* ------------------------------ helpers ------------------------------ */

const PIECE_VALUES: Record<string, number> = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

function materialCount(pos: Pos): { w: number; b: number } {
  let w = 0;
  let b = 0;
  for (const piece of pos.board) {
    if (!piece) continue;
    const v = PIECE_VALUES[piece[1]] ?? 0;
    if (piece[0] === "w") w += v;
    else b += v;
  }
  return { w, b };
}

function detectMode(text: string, ext: string): "pgn" | "fen" | null {
  const trimmed = text.trim();
  if (ext === "fen") return "fen";
  if (ext === "pgn" || ext === "chess") return "pgn";
  if (/^\[\s*\w+\s+"/.test(trimmed)) return "pgn";
  if (/^[pnbrqkPNBRQK1-8/]+\s+[wb]\s+([KQkq]{1,4}|-)\s+([a-h][36]|-)/.test(trimmed) && !/-->/.test(trimmed)) return "fen";
  if (/(^|\s)\d+\.+\s*[a-hNBRQKO0]/.test(trimmed)) return "pgn";
  if (/^[pnbrqkPNBRQK1-8/]+\s+[wb]\s+/.test(trimmed)) return "fen";
  return null;
}

/* ------------------------------ component ------------------------------ */

const LIGHT_SQUARE = "#e5e3d6";
const DARK_SQUARE = "#6f8f76";

export default function ChessViewer({ file, arrayBuffer, detected, fileName }: ViewerProps) {
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [game, setGame] = React.useState<ChessGame | null>(null);
  const [panel, setPanel] = React.useState<"board" | "moves" | "info">("board");
  const [ply, setPly] = React.useState(0);
  const [autoplay, setAutoplay] = React.useState(false);
  const [flipped, setFlipped] = React.useState(false);

  React.useEffect(() => {
    if (!arrayBuffer) {
      setPhase("error");
      setErrorMsg("This file exceeds the in-browser load cap (96 MB). Chess parsing needs the full text.");
      return;
    }
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("PGN files are capped at 8 MB in this viewer.");
      const text = decodeWith(new Uint8Array(arrayBuffer), "utf-8");
      if (!text.trim()) throw new Error("File is empty.");
      const ext = (detected.ext || fileName.split(".").pop() || "").toLowerCase();
      const mode = detectMode(text, ext);
      if (mode === "fen") {
        const pos = parseFen(text);
        if (!pos) throw new Error("Could not parse FEN position string.");
        setGame({ mode: "fen", pos, fen: text.trim().split(/\s+/).slice(0, 6).join(" ") });
      } else if (mode === "pgn") {
        const parsed = parsePgn(text);
        if (!parsed.tokens.length && !Object.keys(parsed.headers).length) throw new Error("No PGN headers or moves found.");
        setGame(parsed);
      } else {
        throw new Error("Neither a PGN game nor a FEN position could be recognized.");
      }
      setPly(0);
      setPhase("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [arrayBuffer, file.size, detected.ext, fileName]);

  const positions = game?.mode === "pgn" ? game.positions : game ? [game.pos] : [];
  const maxPly = positions.length - 1;
  const currentPos = positions[Math.min(ply, maxPly)] ?? null;
  const lastMove = game?.mode === "pgn" && ply > 0 ? game.moves[ply - 1] ?? null : null;
  const checked = currentPos ? inCheck(currentPos, currentPos.turn) : false;
  const checkedKingSq = React.useMemo(() => {
    if (!currentPos || !checked) return -1;
    return kingSquare(currentPos, currentPos.turn);
  }, [currentPos, checked]);

  /* autoplay: 800ms per move */
  React.useEffect(() => {
    if (!autoplay) return;
    if (ply >= maxPly) {
      setAutoplay(false);
      return;
    }
    const t = setInterval(() => setPly((v) => Math.min(v + 1, maxPly)), 800);
    return () => clearInterval(t);
  }, [autoplay, ply, maxPly]);

  /* keyboard: ←/→ step, Home/End jump */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") {
        setAutoplay(false);
        setPly((v) => Math.max(0, v - 1));
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setAutoplay(false);
        setPly((v) => Math.min(maxPly, v + 1));
        e.preventDefault();
      } else if (e.key === "Home") {
        setPly(0);
        e.preventDefault();
      } else if (e.key === "End") {
        setPly(maxPly);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maxPly]);

  const jump = (target: number) => {
    setAutoplay(false);
    setPly(Math.max(0, Math.min(maxPly, target)));
  };

  const material = currentPos ? materialCount(currentPos) : null;
  const whiteName = game?.mode === "pgn" ? game.headers.White || "White" : "White";
  const blackName = game?.mode === "pgn" ? game.headers.Black || "Black" : "Black";
  const resultLabel =
    game?.mode === "pgn" ? game.result : currentPos?.turn === "w" ? "White to move" : "Black to move";

  /* board cells in display order */
  const cells: { sq: number; file: number; rank: number }[] = React.useMemo(() => {
    const out: { sq: number; file: number; rank: number }[] = [];
    for (let vr = 7; vr >= 0; vr--) {
      for (let vf = 0; vf < 8; vf++) {
        const rank = flipped ? 7 - vr : vr;
        const file = flipped ? 7 - vf : vf;
        out.push({ sq: rank * 8 + file, file, rank });
      }
    }
    return out;
  }, [flipped]);

  const movePairs: { no: number; w?: MoveToken; b?: MoveToken; wPly: number; bPly: number }[] = React.useMemo(() => {
    if (game?.mode !== "pgn") return [];
    const realTokens = game.tokens.filter((t) => t.san);
    const out: { no: number; w?: MoveToken; b?: MoveToken; wPly: number; bPly: number }[] = [];
    for (let i = 0; i < realTokens.length; i += 2) {
      out.push({
        no: Math.floor(i / 2) + 1,
        w: realTokens[i],
        b: realTokens[i + 1],
        wPly: i + 1,
        bPly: i + 2,
      });
    }
    return out;
  }, [game]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewerToolbar
        left={
          <>
            <Chip tone="emerald">
              <Swords className="h-3 w-3" />
              {game?.mode === "fen" ? "FEN" : "PGN"}
            </Chip>
            {game?.mode === "pgn" ? (
              <>
                <Chip>{game.moves.filter(Boolean).length} plies</Chip>
                {game.invalidAtPly !== null ? <Chip tone="amber">illegal move at ply {game.invalidAtPly + 1}</Chip> : null}
              </>
            ) : null}
            {currentPos ? <Chip tone={checked ? "rose" : "teal"}>{currentPos.turn === "w" ? "White" : "Black"} to move{checked ? " · check" : ""}</Chip> : null}
            {game?.mode === "pgn" && game.result && game.result !== "*" ? <Chip tone="amber">{game.result}</Chip> : null}
          </>
        }
        center={game?.mode === "pgn" ? (
          <div className="flex items-center gap-1.5">
            <ToolButton title="First (Home)" onClick={() => jump(0)}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton title="Previous (←)" onClick={() => jump(ply - 1)}>
              <ChevronsLeft className="h-3 w-3 rotate-180" />
            </ToolButton>
            <ToolButton title={autoplay ? "Pause autoplay" : "Autoplay"} active={autoplay} onClick={() => setAutoplay((v) => !v)} disabled={maxPly <= 0}>
              {autoplay ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </ToolButton>
            <ToolButton title="Next (→)" onClick={() => jump(ply + 1)}>
              <ChevronsRight className="h-3 w-3" />
            </ToolButton>
            <ToolButton title="Last (End)" onClick={() => jump(maxPly)}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </ToolButton>
            <span className="tabular-nums text-[11px] text-zinc-400">
              {ply}/{maxPly}
            </span>
          </div>
        ) : undefined}
        right={
          <>
            <ToolButton label="Flip" title="Flip board" onClick={() => setFlipped((v) => !v)}>
              <FlipHorizontal className="h-3.5 w-3.5" />
            </ToolButton>
            <Segmented
              value={panel}
              onChange={setPanel}
              options={[
                { value: "board", label: "Board" },
                { value: "moves", label: "Moves" },
                { value: "info", label: "Info" },
              ]}
            />
          </>
        }
      />

      {phase === "error" ? (
        <ErrorCard
          title="Chess parse failed"
          message={errorMsg ?? "Unknown error"}
          hint="Supports PGN games (headers, SAN moves, comments, FEN start positions) and FEN position strings."
        />
      ) : phase === "loading" ? (
        <LoadingState label="Parsing chess data…" />
      ) : !game || !currentPos ? (
        <EmptyHint>No position.</EmptyHint>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {panel === "board" ? (
            <div className="mx-auto flex max-w-[640px] flex-col items-center gap-3 p-4">
              <div className="flex w-full items-center justify-between text-xs text-zinc-400">
                <span className="truncate font-medium text-zinc-300">{blackName}</span>
                {material ? (
                  <span className="shrink-0 tabular-nums text-zinc-500">
                    {material.b}–{material.w}
                    {material.w !== material.b ? ` (${material.w > material.b ? "W" : "B"} +${Math.abs(material.w - material.b)})` : ""}
                  </span>
                ) : null}
              </div>

              <div className="w-full" style={{ maxWidth: "min(100%, 72vh)" }}>
                <div
                  className="grid aspect-square grid-cols-8 overflow-hidden rounded-md border border-zinc-700 shadow-2xl shadow-black/50"
                  style={{ fontSize: "clamp(16px, min(8.4vw, 9vh), 52px)" }}
                >
                  {cells.map((cell) => {
                    const piece = currentPos.board[cell.sq];
                    const isLight = (cell.file + cell.rank) % 2 === 1;
                    const isLastFrom = lastMove?.from === cell.sq;
                    const isLastTo = lastMove?.to === cell.sq;
                    const isCheck = cell.sq === checkedKingSq;
                    const bottomRank = cell.rank === 0;
                    const leftFile = cell.file === 0;
                    return (
                      <div
                        key={cell.sq}
                        className="relative flex select-none items-center justify-center"
                        style={{ background: isLight ? LIGHT_SQUARE : DARK_SQUARE }}
                      >
                        {isLastFrom || isLastTo ? <div className="absolute inset-0" style={{ background: "rgba(251,191,36,0.30)" }} /> : null}
                        {isCheck ? (
                          <div
                            className="absolute inset-0"
                            style={{ background: "radial-gradient(ellipse at center, rgba(244,63,94,0.55), transparent 72%)" }}
                          />
                        ) : null}
                        {piece ? (
                          <span
                            className="relative z-10 leading-none"
                            style={
                              piece[0] === "w"
                                ? { color: "#fafafa", textShadow: "0 1px 2px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.9)" }
                                : { color: "#131316", textShadow: "0 0 2px rgba(255,255,255,0.5), 0 1px 1px rgba(0,0,0,0.7)" }
                            }
                          >
                            {GLYPHS[piece]}
                          </span>
                        ) : null}
                        {bottomRank ? (
                          <span
                            className="absolute bottom-0 right-0.5 z-10 font-mono text-[9px] leading-none"
                            style={{ color: isLight ? "rgba(30,41,25,0.55)" : "rgba(240,240,230,0.65)" }}
                          >
                            {String.fromCharCode(97 + cell.file)}
                          </span>
                        ) : null}
                        {leftFile ? (
                          <span
                            className="absolute left-0.5 top-0.5 z-10 font-mono text-[9px] leading-none"
                            style={{ color: isLight ? "rgba(30,41,25,0.55)" : "rgba(240,240,230,0.65)" }}
                          >
                            {cell.rank + 1}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex w-full items-center justify-between text-xs text-zinc-400">
                <span className="truncate font-medium text-zinc-300">{whiteName}</span>
                <span className="shrink-0 text-zinc-500">{resultLabel}</span>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <span>← / → step · Home / End jump · autoplay 800ms</span>
              </div>
            </div>
          ) : null}

          {panel === "moves" ? (
            <div className="mx-auto max-w-2xl p-4">
              {game.mode === "fen" ? (
                <SectionCard title="FEN position" icon={<Crown className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="FEN" mono>
                      <Copyable value={game.fen} />
                    </Field>
                    <Field label="To move">{currentPos.turn === "w" ? "White" : "Black"}</Field>
                  </InfoGrid>
                  <p className="mt-3 text-[11px] text-zinc-500">Switch to the Board tab to view the position.</p>
                </SectionCard>
              ) : (
                <SectionCard
                  title="Moves"
                  icon={<Swords className="h-3.5 w-3.5" />}
                  right={game.result ? <Chip tone="amber">{game.result}</Chip> : null}
                >
                  {movePairs.length ? (
                    <div className="space-y-1">
                      {movePairs.map((pair) => (
                        <div key={pair.no} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 leading-6">
                          <span className="w-8 shrink-0 text-right font-mono text-[11px] text-zinc-600">{pair.no}.</span>
                          {pair.w?.comment ? <span className="w-full text-[11px] italic text-zinc-500">{pair.w.comment}</span> : null}
                          {pair.w ? (
                            <button
                              type="button"
                              onClick={() => jump(pair.wPly)}
                              className={
                                pair.w.move === null
                                  ? "rounded px-1.5 font-mono text-xs text-amber-400 underline decoration-dotted"
                                  : ply === pair.wPly
                                    ? "rounded bg-emerald-900/60 px-1.5 font-mono text-xs text-emerald-200"
                                    : "rounded px-1.5 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
                              }
                              title={pair.w.move === null ? "Illegal/unparseable move" : pair.w.ambiguous ? "Ambiguous SAN — first match used" : undefined}
                            >
                              {pair.w.san}
                              {pair.w.move === null ? "?" : ""}
                            </button>
                          ) : null}
                          {pair.b?.comment ? <span className="w-full text-[11px] italic text-zinc-500">{pair.b.comment}</span> : null}
                          {pair.b ? (
                            <button
                              type="button"
                              onClick={() => jump(pair.bPly)}
                              className={
                                pair.b.move === null
                                  ? "rounded px-1.5 font-mono text-xs text-amber-400 underline decoration-dotted"
                                  : ply === pair.bPly
                                    ? "rounded bg-emerald-900/60 px-1.5 font-mono text-xs text-emerald-200"
                                    : "rounded px-1.5 font-mono text-xs text-zinc-300 hover:bg-zinc-800"
                              }
                              title={pair.b.move === null ? "Illegal/unparseable move" : pair.b.ambiguous ? "Ambiguous SAN — first match used" : undefined}
                            >
                              {pair.b.san}
                              {pair.b.move === null ? "?" : ""}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyHint>No moves in this game.</EmptyHint>
                  )}
                </SectionCard>
              )}
            </div>
          ) : null}

          {panel === "info" ? (
            <div className="mx-auto grid max-w-3xl gap-4 p-4">
              {game.mode === "pgn" ? (
                <SectionCard title="Game" icon={<Crown className="h-3.5 w-3.5" />}>
                  <InfoGrid>
                    <Field label="Event">{game.headers.Event ?? "—"}</Field>
                    <Field label="Site">{game.headers.Site ?? "—"}</Field>
                    <Field label="Date">{game.headers.Date ?? "—"}</Field>
                    <Field label="Round">{game.headers.Round ?? "—"}</Field>
                    <Field label="White">
                      {game.headers.White ?? "—"}
                      {game.headers.WhiteElo ? ` (${game.headers.WhiteElo})` : ""}
                    </Field>
                    <Field label="Black">
                      {game.headers.Black ?? "—"}
                      {game.headers.BlackElo ? ` (${game.headers.BlackElo})` : ""}
                    </Field>
                    <Field label="Result">{game.result}</Field>
                    {game.headers.ECO ? <Field label="ECO">{game.headers.ECO}</Field> : null}
                    {game.headers.Opening ? <Field label="Opening">{game.headers.Opening}</Field> : null}
                    {game.headers.TimeControl ? <Field label="Time control">{game.headers.TimeControl}</Field> : null}
                  </InfoGrid>
                  {Object.keys(game.headers).filter((k) => !["Event", "Site", "Date", "Round", "White", "Black", "Result", "WhiteElo", "BlackElo", "ECO", "Opening", "TimeControl", "FEN", "Fen"].includes(k)).length ? (
                    <div className="mt-3 border-t border-zinc-800 pt-3">
                      <InfoGrid>
                        {Object.entries(game.headers)
                          .filter(([k]) => !["Event", "Site", "Date", "Round", "White", "Black", "Result", "WhiteElo", "BlackElo", "ECO", "Opening", "TimeControl", "FEN", "Fen"].includes(k))
                          .map(([k, v]) => (
                            <Field key={k} label={k}>
                              {v}
                            </Field>
                          ))}
                      </InfoGrid>
                    </div>
                  ) : null}
                </SectionCard>
              ) : null}

              <SectionCard title="Position" icon={<Swords className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  <Field label="FEN" mono>
                    <Copyable value={toFen(currentPos)} />
                  </Field>
                  <Field label="To move">{currentPos.turn === "w" ? "White" : "Black"}</Field>
                  <Field label="Castling">{currentPos.castling || "—"}</Field>
                  <Field label="En passant">{currentPos.ep >= 0 ? indexToAlgebraic(currentPos.ep) : "—"}</Field>
                  <Field label="Halfmove clock">{currentPos.half}</Field>
                  <Field label="Fullmove">{currentPos.full}</Field>
                  <Field label="Check">{checked ? "Yes" : "No"}</Field>
                  {material ? (
                    <Field label="Material">
                      White {material.w} · Black {material.b}
                      {material.w !== material.b ? ` · ${material.w > material.b ? "White" : "Black"} +${Math.abs(material.w - material.b)}` : ""}
                    </Field>
                  ) : null}
                </InfoGrid>
              </SectionCard>

              {game.mode === "pgn" ? (
                <SectionCard title="Legal moves in current position" icon={<Swords className="h-3.5 w-3.5" />}>
                  {(() => {
                    const moves = legalMoves(currentPos);
                    if (!moves.length) return <EmptyHint>{checked ? "Checkmate (or stalemate)." : "Stalemate — no legal moves."}</EmptyHint>;
                    const bySq = new Map<number, string[]>();
                    for (const m of moves) {
                      const key = m.from;
                      const arr = bySq.get(key) ?? [];
                      arr.push(indexToAlgebraic(m.to) + (m.promo ? `=${m.promo}` : ""));
                      bySq.set(key, arr);
                    }
                    return (
                      <div className="space-y-1 font-mono text-[11px]">
                        {Array.from(bySq.entries()).map(([from, list]) => (
                          <div key={from} className="flex gap-2">
                            <span className="w-8 shrink-0 text-right text-zinc-600">{indexToAlgebraic(from)}</span>
                            <span className="text-zinc-300">{list.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </SectionCard>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[11px] text-zinc-500">
        <Swords className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Amber = last move · rose glow = check · click moves or use ← / →</span>
        <span className="ml-auto hidden shrink-0 text-zinc-600 sm:inline">{fileName}</span>
      </div>
    </div>
  );
}
