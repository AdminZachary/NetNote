/**
 * Persistence of vaults inside the browser (IndexedDB). Everything a person writes in the headset
 * lives here until they export it. One interface, two implementations: IndexedDB for the app and an
 * in-memory one for tests.
 */

export interface StoredVault {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Where it came from: the bundled sample, an import, or created empty in the headset. */
  origin: 'sample' | 'import' | 'empty';
}

export interface StoredFile {
  vaultId: string;
  path: string;
  /** Text of notes. */
  content?: string;
  /** Bytes of attachments. */
  blob?: Blob;
  mtime: number;
  ctime: number;
  size: number;
}

export interface VaultStore {
  listVaults(): Promise<StoredVault[]>;
  getVault(id: string): Promise<StoredVault | undefined>;
  putVault(v: StoredVault): Promise<void>;
  /** Deletes the vault, its files and its state. */
  deleteVault(id: string): Promise<void>;
  listFiles(vaultId: string): Promise<StoredFile[]>;
  getFile(vaultId: string, path: string): Promise<StoredFile | undefined>;
  putFiles(files: StoredFile[]): Promise<void>;
  deleteFiles(vaultId: string, paths: string[]): Promise<void>;
  /** Small JSON documents per vault: wall layout, pinned cards, room placement, settings… */
  getState<T>(vaultId: string, key: string): Promise<T | undefined>;
  setState<T>(vaultId: string, key: string, value: T): Promise<void>;
}

export class MemoryStore implements VaultStore {
  private vaults = new Map<string, StoredVault>();
  private files = new Map<string, StoredFile>();
  private state = new Map<string, unknown>();
  private k = (a: string, b: string): string => a + '\u0000' + b;

  listVaults(): Promise<StoredVault[]> {
    return Promise.resolve([...this.vaults.values()].sort((a, b) => b.updatedAt - a.updatedAt));
  }
  getVault(id: string): Promise<StoredVault | undefined> {
    return Promise.resolve(this.vaults.get(id));
  }
  putVault(v: StoredVault): Promise<void> {
    this.vaults.set(v.id, { ...v });
    return Promise.resolve();
  }
  deleteVault(id: string): Promise<void> {
    this.vaults.delete(id);
    for (const key of [...this.files.keys()]) if (key.startsWith(id + '\u0000')) this.files.delete(key);
    for (const key of [...this.state.keys()]) if (key.startsWith(id + '\u0000')) this.state.delete(key);
    return Promise.resolve();
  }
  listFiles(vaultId: string): Promise<StoredFile[]> {
    return Promise.resolve([...this.files.values()].filter((f) => f.vaultId === vaultId).map((f) => ({ ...f })));
  }
  getFile(vaultId: string, path: string): Promise<StoredFile | undefined> {
    const f = this.files.get(this.k(vaultId, path));
    return Promise.resolve(f ? { ...f } : undefined);
  }
  putFiles(files: StoredFile[]): Promise<void> {
    for (const f of files) this.files.set(this.k(f.vaultId, f.path), { ...f });
    return Promise.resolve();
  }
  deleteFiles(vaultId: string, paths: string[]): Promise<void> {
    for (const p of paths) this.files.delete(this.k(vaultId, p));
    return Promise.resolve();
  }
  getState<T>(vaultId: string, key: string): Promise<T | undefined> {
    const v = this.state.get(this.k(vaultId, key));
    return Promise.resolve(v === undefined ? undefined : (structuredClone(v) as T));
  }
  setState<T>(vaultId: string, key: string, value: T): Promise<void> {
    this.state.set(this.k(vaultId, key), structuredClone(value));
    return Promise.resolve();
  }
}

const DB_NAME = 'netnote';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export class IdbStore implements VaultStore {
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<IdbStore> {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('vaults')) db.createObjectStore('vaults', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) {
        const files = db.createObjectStore('files', { keyPath: ['vaultId', 'path'] });
        files.createIndex('vault', 'vaultId');
      }
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
    };
    return new IdbStore(await req(open));
  }

  close(): void {
    this.db.close();
  }

  async listVaults(): Promise<StoredVault[]> {
    const all = await req(this.db.transaction('vaults').objectStore('vaults').getAll() as IDBRequest<StoredVault[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getVault(id: string): Promise<StoredVault | undefined> {
    return req(this.db.transaction('vaults').objectStore('vaults').get(id) as IDBRequest<StoredVault | undefined>);
  }
  async putVault(v: StoredVault): Promise<void> {
    const tx = this.db.transaction('vaults', 'readwrite');
    tx.objectStore('vaults').put(v);
    await done(tx);
  }
  async deleteVault(id: string): Promise<void> {
    const tx = this.db.transaction(['vaults', 'files', 'state'], 'readwrite');
    tx.objectStore('vaults').delete(id);
    tx.objectStore('files').delete(IDBKeyRange.bound([id, ''], [id, '￿']));
    tx.objectStore('state').delete(IDBKeyRange.bound(id + '\u0000', id + '\u0000￿'));
    await done(tx);
  }
  listFiles(vaultId: string): Promise<StoredFile[]> {
    const index = this.db.transaction('files').objectStore('files').index('vault');
    return req(index.getAll(vaultId) as IDBRequest<StoredFile[]>);
  }
  getFile(vaultId: string, path: string): Promise<StoredFile | undefined> {
    return req(this.db.transaction('files').objectStore('files').get([vaultId, path]) as IDBRequest<StoredFile | undefined>);
  }
  async putFiles(files: StoredFile[]): Promise<void> {
    if (!files.length) return;
    const tx = this.db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    for (const f of files) store.put(f);
    await done(tx);
  }
  async deleteFiles(vaultId: string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const tx = this.db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    for (const p of paths) store.delete([vaultId, p]);
    await done(tx);
  }
  getState<T>(vaultId: string, key: string): Promise<T | undefined> {
    return req(
      this.db
        .transaction('state')
        .objectStore('state')
        .get(vaultId + '\u0000' + key) as IDBRequest<T | undefined>,
    );
  }
  async setState<T>(vaultId: string, key: string, value: T): Promise<void> {
    const tx = this.db.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, vaultId + '\u0000' + key);
    await done(tx);
  }
}
