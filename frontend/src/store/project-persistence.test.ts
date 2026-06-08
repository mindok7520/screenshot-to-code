import { readProjectSnapshot, writeProjectSnapshot } from "./project-persistence";

function createLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: jest.fn(() => values.clear()),
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    key: jest.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: jest.fn((key: string) => {
      values.delete(key);
    }),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function createReadableIndexedDb(value: string | null): IDBFactory {
  const open = jest.fn(() => {
    const openRequest = {} as IDBOpenDBRequest;
    const database = {
      objectStoreNames: {
        contains: jest.fn(() => true),
      },
      close: jest.fn(),
      transaction: jest.fn(() => {
        const transaction = {
          objectStore: jest.fn(() => ({
            get: jest.fn(() => {
              const request = { result: value } as IDBRequest<string | null>;
              setTimeout(() => {
                request.onsuccess?.({} as Event);
                transaction.oncomplete?.({} as Event);
              }, 0);
              return request;
            }),
          })),
          onabort: null,
          oncomplete: null,
          onerror: null,
        } as unknown as IDBTransaction;

        return transaction;
      }),
    } as unknown as IDBDatabase;

    Object.defineProperty(openRequest, "result", {
      configurable: true,
      value: database,
    });
    setTimeout(() => {
      openRequest.onsuccess?.({} as Event);
    }, 0);

    return openRequest;
  });

  return { open } as unknown as IDBFactory;
}

function createSnapshot(savedAt: number, body: string): string {
  return JSON.stringify({
    version: 1,
    savedAt,
    state: {
      body,
    },
  });
}

describe("project persistence", () => {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(
    globalThis,
    "indexedDB"
  );
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );

  afterEach(() => {
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    } else {
      Reflect.deleteProperty(globalThis, "indexedDB");
    }

    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  test("falls back to localStorage when IndexedDB is unavailable", async () => {
    const storage = createLocalStorage();
    Reflect.deleteProperty(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    await writeProjectSnapshot("project", "snapshot-json");

    await expect(readProjectSnapshot("project")).resolves.toBe(
      "snapshot-json"
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      "screenshot-to-code:project-snapshots:project",
      "snapshot-json"
    );
  });

  test("skips oversized localStorage fallback snapshots", async () => {
    const storage = createLocalStorage();
    Reflect.deleteProperty(globalThis, "indexedDB");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    await writeProjectSnapshot("project", "x".repeat(2_000_001));

    await expect(readProjectSnapshot("project")).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      "screenshot-to-code:project-snapshots:project"
    );
  });

  test("prefers a newer local mirror over a stale IndexedDB snapshot", async () => {
    const storage = createLocalStorage();
    const localSnapshot = createSnapshot(200, "local");
    const indexedDbSnapshot = createSnapshot(100, "indexed-db");

    storage.setItem(
      "screenshot-to-code:project-snapshots:project",
      localSnapshot
    );
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: createReadableIndexedDb(indexedDbSnapshot),
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    await expect(readProjectSnapshot("project")).resolves.toBe(localSnapshot);
  });

  test("uses IndexedDB when the local mirror is older", async () => {
    const storage = createLocalStorage();
    const localSnapshot = createSnapshot(100, "local");
    const indexedDbSnapshot = createSnapshot(200, "indexed-db");

    storage.setItem(
      "screenshot-to-code:project-snapshots:project",
      localSnapshot
    );
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: createReadableIndexedDb(indexedDbSnapshot),
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    await expect(readProjectSnapshot("project")).resolves.toBe(
      indexedDbSnapshot
    );
  });

  test("uses localStorage directly after IndexedDB fails", async () => {
    const storage = createLocalStorage();
    const open = jest.fn(() => {
      throw new Error("IndexedDB blocked");
    });
    const consoleWarn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: { open } as unknown as IDBFactory,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    await writeProjectSnapshot("project", "first-snapshot");
    await writeProjectSnapshot("project", "second-snapshot");

    await expect(readProjectSnapshot("project")).resolves.toBe(
      "second-snapshot"
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenLastCalledWith(
      "screenshot-to-code:project-snapshots:project",
      "second-snapshot"
    );

    consoleWarn.mockRestore();
  });
});
