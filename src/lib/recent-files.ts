/**
 * OMNISCOPE — IndexedDB-backed recent files (Task 4-c).
 *
 * Raw IndexedDB API, no dependencies. DB "omniscope-recents" v1, object store
 * "recent" (keyPath "id"), index "by_opened" on lastOpened. Blobs are stored
 * natively on the SAME record (field `blob`) but only for files <= RECENT_CACHE_CAP.
 *
 * Everything is safe in SSR/Node (Next.js prerenders the shell): all exported
 * functions guard `typeof indexedDB === "undefined"` and degrade to no-ops.
 * No function ever rejects — errors are caught and logged via console.warn.
 */

export interface RecentEntry {
  id: string;            // crypto.randomUUID()
  name: string;
  size: number;
  mime: string;
  lastOpened: number;    // epoch ms
  detectedName?: string; // e.g. "Portable Network Graphics"
  viewerId?: string;     // e.g. "image"
  cached: boolean;       // whether the blob was persisted
}

/** Files up to this size get their bytes cached for one-click reopening. */
export const RECENT_CACHE_CAP = 8 * 1024 * 1024; // 8MB

/* --------------------------------- internals -------------------------------- */

const DB_NAME = "omniscope-recents";
const DB_VERSION = 1;
const STORE = "recent";
const INDEX_OPENED = "by_opened";
const MAX_ENTRIES = 50;

/** Stored record — same object as RecentEntry plus the optional cached Blob. */
interface RecentRecord extends RecentEntry {
  blob?: Blob;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        dbPromise = null;
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex(INDEX_OPENED, "lastOpened");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab wants to upgrade (we only ever ship version 1) — let it.
        db.onversionchange = () => {
          dbPromise = null;
          db.close();
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB open failed"));
      };
      req.onblocked = () => {
        console.warn("[recent-files] IndexedDB open blocked by another tab");
      };
    });
  }
  return dbPromise;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through to the cheap id */
    }
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Strip the Blob off a stored record → public RecentEntry shape. */
function toEntry(rec: RecentRecord): RecentEntry {
  return {
    id: rec.id,
    name: rec.name,
    size: rec.size,
    mime: rec.mime,
    lastOpened: rec.lastOpened,
    ...(rec.detectedName !== undefined ? { detectedName: rec.detectedName } : {}),
    ...(rec.viewerId !== undefined ? { viewerId: rec.viewerId } : {}),
    cached: rec.blob != null,
  };
}

/* ------------------------------- public API --------------------------------- */

/**
 * Record a freshly opened file. Dedupes by name+size inside a single
 * readwrite transaction (index cursor scan) — a match just gets its
 * lastOpened/detected info refreshed. Caps the store at MAX_ENTRIES by
 * deleting the oldest entries (by lastOpened) beyond the cap.
 */
export function addRecentFile(file: File, detected?: { name?: string; viewer?: string }): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return openDb()
    .then(
      (db) =>
        new Promise<void>((resolve) => {
          const records: RecentRecord[] = [];
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };

          let tx: IDBTransaction;
          try {
            tx = db.transaction(STORE, "readwrite");
          } catch (err) {
            console.warn("[recent-files] transaction start failed:", err);
            finish();
            return;
          }

          tx.oncomplete = finish;
          tx.onerror = () => {
            console.warn("[recent-files] add transaction error:", tx.error);
          };
          tx.onabort = () => {
            // quota exceeded, blocked DB, … — never throw to callers
            console.warn("[recent-files] add transaction aborted:", tx.error);
            finish();
          };

          const store = tx.objectStore(STORE);
          const cursorReq = store.index(INDEX_OPENED).openCursor();
          cursorReq.onerror = () => {
            console.warn("[recent-files] add cursor failed:", cursorReq.error);
          };
          cursorReq.onsuccess = () => {
            try {
              const cursor = cursorReq.result;
              if (cursor) {
                const rec = cursor.value as RecentRecord;
                if (rec && typeof rec.id === "string") records.push(rec);
                cursor.continue();
                return;
              }

              // Index scan complete — still inside the same transaction task.
              const now = Date.now();
              const cacheable = file.size <= RECENT_CACHE_CAP;
              const match = records.find((r) => r.name === file.name && r.size === file.size);

              if (match) {
                // Dedupe: refresh timestamp + detection info instead of adding a copy.
                match.lastOpened = now;
                if (file.type) match.mime = file.type;
                if (detected?.name) match.detectedName = detected.name;
                if (detected?.viewer) match.viewerId = detected.viewer;
                if (cacheable) {
                  match.cached = true;
                  match.blob = file;
                } else {
                  match.cached = false;
                  match.blob = undefined;
                }
                store.put(match);
              } else {
                const rec: RecentRecord = {
                  id: makeId(),
                  name: file.name,
                  size: file.size,
                  mime: file.type,
                  lastOpened: now,
                  ...(detected?.name ? { detectedName: detected.name } : {}),
                  ...(detected?.viewer ? { viewerId: detected.viewer } : {}),
                  cached: cacheable,
                  ...(cacheable ? { blob: file } : {}),
                };
                store.add(rec);
                records.push(rec);
              }

              // Cap the store: delete the oldest entries beyond MAX_ENTRIES.
              if (records.length > MAX_ENTRIES) {
                const sorted = [...records].sort((a, b) => a.lastOpened - b.lastOpened);
                const excess = records.length - MAX_ENTRIES;
                for (let i = 0; i < excess; i++) store.delete(sorted[i].id);
              }
            } catch (err) {
              console.warn("[recent-files] add step failed:", err);
              finish();
            }
          };
        }),
    )
    .catch((err) => {
      console.warn("[recent-files] addRecentFile failed:", err);
    });
}

/** Newest-first list of recent entries (default limit 20). Blobs are stripped. */
export async function listRecentFiles(limit = 20): Promise<RecentEntry[]> {
  if (!idbAvailable() || limit <= 0) return [];
  try {
    const db = await openDb();
    return await new Promise<RecentEntry[]>((resolve) => {
      const out: RecentEntry[] = [];
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve(out);
        }
      };

      const tx = db.transaction(STORE, "readonly");
      tx.oncomplete = finish;
      tx.onerror = () => {
        console.warn("[recent-files] list transaction error:", tx.error);
      };
      tx.onabort = () => {
        console.warn("[recent-files] list transaction aborted:", tx.error);
        finish();
      };

      const req = tx.objectStore(STORE).index(INDEX_OPENED).openCursor(null, "prev");
      req.onerror = () => {
        console.warn("[recent-files] list cursor failed:", req.error);
      };
      req.onsuccess = () => {
        try {
          const cursor = req.result;
          if (cursor && out.length < limit) {
            const rec = cursor.value as RecentRecord;
            if (rec && typeof rec.id === "string") out.push(toEntry(rec));
            cursor.continue();
          }
        } catch (err) {
          console.warn("[recent-files] list step failed:", err);
          finish();
        }
      };
    });
  } catch (err) {
    console.warn("[recent-files] listRecentFiles failed:", err);
    return [];
  }
}

/**
 * Fetch one entry together with its cached Blob (null when the file was too
 * large to cache or the blob is unavailable). Returns null for unknown ids.
 */
export async function getRecentFile(id: string): Promise<{ entry: RecentEntry; blob: Blob | null } | null> {
  if (!idbAvailable() || !id) return null;
  try {
    const db = await openDb();
    return await new Promise<{ entry: RecentEntry; blob: Blob | null } | null>((resolve) => {
      let settled = false;
      const done = (v: { entry: RecentEntry; blob: Blob | null } | null) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };

      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const rec = req.result as RecentRecord | undefined;
        if (rec && typeof rec.id === "string") {
          done({ entry: toEntry(rec), blob: rec.blob ?? null });
        } else {
          done(null);
        }
      };
      req.onerror = () => {
        console.warn("[recent-files] get failed:", req.error);
        done(null);
      };
    });
  } catch (err) {
    console.warn("[recent-files] getRecentFile failed:", err);
    return null;
  }
}

/** Remove a single entry by id (fire-and-forget safe). */
export async function removeRecentFile(id: string): Promise<void> {
  if (!idbAvailable() || !id) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn("[recent-files] remove transaction error:", tx.error);
        resolve();
      };
      tx.onabort = () => {
        console.warn("[recent-files] remove transaction aborted:", tx.error);
        resolve();
      };
      tx.objectStore(STORE).delete(id);
    });
  } catch (err) {
    console.warn("[recent-files] removeRecentFile failed:", err);
  }
}

/** Wipe all recent entries. */
export async function clearRecentFiles(): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        console.warn("[recent-files] clear transaction error:", tx.error);
        resolve();
      };
      tx.onabort = () => {
        console.warn("[recent-files] clear transaction aborted:", tx.error);
        resolve();
      };
      tx.objectStore(STORE).clear();
    });
  } catch (err) {
    console.warn("[recent-files] clearRecentFiles failed:", err);
  }
}

/* --------------------------------- formatting -------------------------------- */

/** Human "just now / 2 min ago / 3 h ago / 2 d ago / Jan 5" formatting. */
export function formatRecentWhen(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return diff <= 45_000 ? "just now" : "1 min ago";
  }
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  const date = new Date(ts);
  const now = new Date();
  try {
    return date.toLocaleDateString(
      "en-US",
      date.getFullYear() === now.getFullYear()
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" },
    );
  } catch {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }
}
