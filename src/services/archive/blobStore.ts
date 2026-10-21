/**
 * Storage for original scans and page renders.
 *
 * Write-once by design: `put` refuses to overwrite an existing key and there is no delete, so
 * originals are never discarded (page replacements are stored under new keys).
 *
 * In the browser: IndexedDB, each blob encrypted with AES-GCM using a NON-extractable key that is
 * itself kept in IndexedDB. This protects at-rest data from casual inspection of the browser
 * profile, not from code running in the page — production storage must be server-side and
 * encrypted with managed keys.
 */

export interface BlobStore {
  readonly persistent: boolean;
  readonly encrypted: boolean;
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | undefined>;
  has(key: string): Promise<boolean>;
}

export class ImmutableBlobError extends Error {
  constructor(key: string) {
    super(`immutable:${key}`);
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly persistent = false;
  readonly encrypted = false;
  private readonly map = new Map<string, Blob>();

  async put(key: string, blob: Blob) {
    if (this.map.has(key)) throw new ImmutableBlobError(key);
    this.map.set(key, blob);
  }
  async get(key: string) {
    return this.map.get(key);
  }
  async has(key: string) {
    return this.map.has(key);
  }
}

const DB_NAME = "qasr-al-adala-archive";
const STORE = "blobs";
const KEYS = "keys";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class EncryptedIdbBlobStore implements BlobStore {
  readonly persistent = true;
  readonly encrypted = true;
  private dbPromise?: Promise<IDBDatabase>;
  private keyPromise?: Promise<CryptoKey>;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore(STORE);
        open.result.createObjectStore(KEYS);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }

  private key(): Promise<CryptoKey> {
    this.keyPromise ??= (async () => {
      const db = await this.db();
      const existing = await request(db.transaction(KEYS, "readonly").objectStore(KEYS).get("master"));
      if (existing) return existing as CryptoKey;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await request(db.transaction(KEYS, "readwrite").objectStore(KEYS).put(key, "master"));
      return key;
    })();
    return this.keyPromise;
  }

  async has(key: string) {
    const db = await this.db();
    const count = await request(db.transaction(STORE, "readonly").objectStore(STORE).count(key));
    return count > 0;
  }

  async put(key: string, blob: Blob) {
    if (await this.has(key)) throw new ImmutableBlobError(key);
    const cryptoKey = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, await blob.arrayBuffer());
    const db = await this.db();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ iv, data, type: blob.type }, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(key: string) {
    const db = await this.db();
    const record = (await request(db.transaction(STORE, "readonly").objectStore(STORE).get(key))) as
      | { iv: Uint8Array; data: ArrayBuffer; type: string }
      | undefined;
    if (!record) return undefined;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, await this.key(), record.data);
    return new Blob([plain], { type: record.type });
  }
}

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  if (!store) {
    const supported = typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
    store = supported ? new EncryptedIdbBlobStore() : new MemoryBlobStore();
  }
  return store;
}

/** Tests and diagnostics can swap the store. */
export function setBlobStore(next: BlobStore) {
  store = next;
}
