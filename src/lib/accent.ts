/**
 * Accent theme system for Omniscope.
 *
 * The app's brand accent is Tailwind's `emerald` scale (313 utility usages).
 * Tailwind v4 resolves every `*-emerald-*` utility through the CSS custom
 * properties `--color-emerald-50 … --color-emerald-950` (emitted on `:root`
 * by `@theme`). Each accent therefore redefines that entire variable family
 * under `html[data-accent="…"]` (globals.css) — one declaration recolors
 * text / bg / border / outline / ring / gradient / shadow / accent utilities
 * app-wide with zero component changes.
 *
 * "emerald" is the default: no `data-accent` attribute is set, so native
 * Tailwind values apply unchanged.
 */

export interface AccentDef {
  id: string;
  label: string;
  /** representative mid-tone hex used for the picker swatch */
  swatch: string;
  /** one-line hint shown under the picker title */
  note: string;
}

export const ACCENTS: AccentDef[] = [
  { id: "emerald", label: "Emerald", swatch: "#10b981", note: "default" },
  { id: "rose", label: "Rose", swatch: "#f43f5e", note: "warm red" },
  { id: "amber", label: "Amber", swatch: "#f59e0b", note: "golden" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6", note: "cool purple" },
  { id: "cyan", label: "Cyan", swatch: "#06b6d4", note: "aqua" },
  { id: "orange", label: "Orange", swatch: "#f97316", note: "sunset" },
  { id: "lime", label: "Lime", swatch: "#84cc16", note: "chartreuse" },
  { id: "fuchsia", label: "Fuchsia", swatch: "#d946ef", note: "magenta" },
  { id: "teal", label: "Teal", swatch: "#14b8a6", note: "sea green" },
];

export const ACCENT_STORAGE_KEY = "omniscope.accent.v1";

/** Valid ids for the data-accent attribute (emerald needs no attribute). */
const DATA_IDS = new Set(ACCENTS.map((a) => a.id).filter((id) => id !== "emerald"));

export function isAccentId(value: string | null | undefined): value is string {
  return !!value && ACCENTS.some((a) => a.id === value);
}

/** Read the persisted accent id (defaults to "emerald", never throws). */
export function readAccent(): string {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentId(v) ? (v as string) : "emerald";
  } catch {
    return "emerald";
  }
}

/** Apply + persist an accent. Pass "emerald" to restore the default. */
export function applyAccent(id: string): void {
  try {
    if (isAccentId(id) && id !== "emerald") {
      document.documentElement.dataset.accent = id;
      localStorage.setItem(ACCENT_STORAGE_KEY, id);
    } else {
      delete document.documentElement.dataset.accent;
      localStorage.removeItem(ACCENT_STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode) — attribute still applied above when possible */
  }
}

/** Inline script body used pre-paint in layout.tsx (kept in sync with applyAccent). */
export const ACCENT_RESTORE_SCRIPT =
  `try{var a=localStorage.getItem('${ACCENT_STORAGE_KEY}');` +
  `if(a&&a!=='emerald'&&${JSON.stringify([...DATA_IDS])}.indexOf(a)>=0)` +
  `document.documentElement.dataset.accent=a}catch(e){}`;
