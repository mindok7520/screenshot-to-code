const DATABASE_NAME = "screenshot-to-code";
const DATABASE_VERSION = 1;
const STORE_NAME = "project-snapshots";
const LOCAL_STORAGE_KEY_PREFIX = `${DATABASE_NAME}:${STORE_NAME}:`;
const MAX_LOCAL_STORAGE_SNAPSHOT_LENGTH = 2_000_000;

let isIndexedDbUnavailable = false;

function hasIndexedDb(): boolean {
  return !isIndexedDbUnavailable && typeof indexedDB !== "undefined";
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function toLocalStorageKey(key: string): string {
  return `${LOCAL_STORAGE_KEY_PREFIX}${key}`;
}

function readLocalProjectSnapshot(key: string): string | null {
  if (!hasLocalStorage()) return null;

  try {
    return localStorage.getItem(toLocalStorageKey(key));
  } catch (error) {
    console.warn("Failed to read fallback project snapshot", error);
    return null;
  }
}

function writeLocalProjectSnapshot(key: string, value: string): void {
  if (!hasLocalStorage()) return;

  try {
    if (value.length > MAX_LOCAL_STORAGE_SNAPSHOT_LENGTH) {
      localStorage.removeItem(toLocalStorageKey(key));
      return;
    }

    localStorage.setItem(toLocalStorageKey(key), value);
  } catch (error) {
    console.warn("Failed to write fallback project snapshot", error);
  }
}

function getSnapshotSavedAt(value: string | null): number {
  if (!value) return 0;

  try {
    const parsed = JSON.parse(value) as { savedAt?: unknown };
    return typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
  } catch {
    return 0;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = callback(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function readProjectSnapshot(key: string): Promise<string | null> {
  const localValue = readLocalProjectSnapshot(key);
  if (!hasIndexedDb()) return localValue;

  try {
    const value = await withStore("readonly", (store) => store.get(key));
    if (typeof value === "string") {
      return getSnapshotSavedAt(localValue) > getSnapshotSavedAt(value)
        ? localValue
        : value;
    }
  } catch (error) {
    isIndexedDbUnavailable = true;
    console.warn("Failed to read project snapshot", error);
  }

  return localValue;
}

export async function writeProjectSnapshot(
  key: string,
  value: string
): Promise<void> {
  writeLocalProjectSnapshot(key, value);

  if (!hasIndexedDb()) {
    return;
  }

  try {
    await withStore("readwrite", (store) => store.put(value, key));
  } catch (error) {
    isIndexedDbUnavailable = true;
    console.warn("Failed to write project snapshot", error);
  }
}
