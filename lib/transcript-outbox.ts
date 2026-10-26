"use client";

export type PendingContribution = {
  key: string;
  matchId: string;
  userId: string;
  id: string;
  source: "speech" | "text";
  createdAt: number;
  audio?: Blob;
  text?: string;
};

let opening: Promise<IDBDatabase> | null = null;
function database() {
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("debate-transcripts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(new Error("Browser storage is unavailable. Keep this page open and use text.")); };
  });
}

async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", mode);
    const request = operation(tx.objectStore("pending"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(new Error("Unable to save this contribution in your browser."));
  });
}

export function persistContribution(entry: PendingContribution) {
  return transaction("readwrite", store => store.put(entry));
}
export function removeContribution(key: string) {
  return transaction("readwrite", store => store.delete(key));
}
export async function pendingContributions(matchId: string, userId: string) {
  const entries = await transaction("readonly", store => store.getAll()) as PendingContribution[];
  return entries.filter(entry => entry.matchId === matchId && entry.userId === userId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
