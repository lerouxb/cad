import { migrateDoc } from "./migrations";
import type { Doc } from "./types";

export const DOC_STORAGE_KEY = "cad.doc";

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

export function clearSavedDoc(): void {
  try {
    globalThis.localStorage?.removeItem(DOC_STORAGE_KEY);
  } catch {
    // Storage can be disabled; there is nothing else to clean up.
  }
}
