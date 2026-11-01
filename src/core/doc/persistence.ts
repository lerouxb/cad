import { migrateDoc } from "./migrations";
import type { Doc } from "./types";

export const DOC_STORAGE_KEY = "cad.doc";
export const LOCAL_FILES_KEY = "cad.files";

export interface LocalFileEntry {
  id: string;
  name: string;
  featureCount: number;
  updatedAt: number;
}

function localDocKey(id: string): string {
  return `cad.file.${id}`;
}

export function serializeDoc(doc: Doc): string {
  return JSON.stringify(doc);
}

export function deserializeDoc(text: string): Doc | null {
  try {
    return migrateDoc(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Persist the part locally. Returns false when storage is unavailable. */
export function saveDoc(doc: Doc): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(DOC_STORAGE_KEY, serializeDoc(doc));
    return true;
  } catch {
    return false;
  }
}

export function loadDoc(): Doc | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const text = storage.getItem(DOC_STORAGE_KEY);
    return text ? deserializeDoc(text) : null;
  } catch {
    return null;
  }
}

/** The local file index, newest first. Malformed entries are ignored. */
export function loadFileIndex(): LocalFileEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(LOCAL_FILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isLocalFileEntry)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Save a part into the local file list (used by autosave and make-a-copy). */
export function saveLocalFile(doc: Doc): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(localDocKey(doc.id), serializeDoc(doc));
    const others = loadFileIndex().filter((entry) => entry.id !== doc.id);
    const next: LocalFileEntry[] = [
      {
        id: doc.id,
        name: doc.name,
        featureCount: doc.features.length,
        updatedAt: Date.now(),
      },
      ...others,
    ].slice(0, 30);
    storage.setItem(LOCAL_FILES_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function loadLocalFile(id: string): Doc | null {
  try {
    const text = globalThis.localStorage?.getItem(localDocKey(id));
    return text ? deserializeDoc(text) : null;
  } catch {
    return null;
  }
}

export function deleteLocalFile(id: string): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.removeItem(localDocKey(id));
    storage.setItem(
      LOCAL_FILES_KEY,
      JSON.stringify(loadFileIndex().filter((entry) => entry.id !== id)),
    );
  } catch {
    // Storage can be disabled; there is nothing else to clean up.
  }
}

function isLocalFileEntry(value: unknown): value is LocalFileEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.featureCount === "number" &&
    typeof record.updatedAt === "number"
  );
}

export function clearSavedDoc(): void {
  try {
    globalThis.localStorage?.removeItem(DOC_STORAGE_KEY);
  } catch {
    // Storage can be disabled; there is nothing else to clean up.
  }
}
