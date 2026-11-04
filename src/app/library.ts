/**
 * The library: which vaults exist, the one that is open, and every change made to it.
 *
 * It owns the in-memory Vault model, keeps IndexedDB in sync with it and recomputes insights after
 * changes. UI code (2D or XR) talks only to this class, never to storage directly.
 */
import { clusterInfo, type ClusterInfo } from '../core/insights/cluster';
import { computeInsights, type Insights } from '../core/insights/engine';
import { Vault } from '../core/vault/vault';
import type { StoredFile, StoredVault, VaultStore } from '../storage/store';
import { writeZip, type ImportedFile } from '../storage/transfer';
import { Emitter } from './events';

export interface LibraryEvents extends Record<string, unknown> {
  /** A different vault was opened. */
  opened: { vault: Vault; meta: StoredVault };
  /** Notes changed (paths written or removed). */
  changed: { paths: string[]; version: number };
  /** Insights were recomputed. */
  insights: Insights;
  error: Error;
}

export interface NewVaultInput {
  name: string;
  origin: StoredVault['origin'];
  files: ImportedFile[];
}

let counter = 0;
const newId = (): string => `v${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export class Library extends Emitter<LibraryEvents> {
  vault: Vault | null = null;
  meta: StoredVault | null = null;
  private insightsCache: Insights | null = null;
  private insightsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly store: VaultStore,
    private readonly clock: () => number = Date.now,
  ) {
    super();
  }

  list(): Promise<StoredVault[]> {
    return this.store.listVaults();
  }

  /** Store a new vault from imported files and return its id. */
  async add(input: NewVaultInput): Promise<string> {
    const now = this.clock();
    const id = newId();
    await this.store.putVault({ id, name: input.name, createdAt: now, updatedAt: now, origin: input.origin });
    await this.store.putFiles(
      input.files.map((f): StoredFile => ({
        vaultId: id,
        path: f.path,
        content: f.content,
        blob: f.bytes ? new Blob([f.bytes as BlobPart]) : undefined,
        mtime: f.mtime || now,
        ctime: f.mtime || now,
        size: f.content?.length ?? f.bytes?.byteLength ?? 0,
      })),
    );
    return id;
  }

  async open(id: string): Promise<Vault> {
    const meta = await this.store.getVault(id);
    if (!meta) throw new Error(`Vault ${id} not found`);
    const files = await this.store.listFiles(id);
    this.vault = Vault.from(
      meta.name,
      files.map((f) => ({ path: f.path, content: f.content, mtime: f.mtime, ctime: f.ctime, size: f.size })),
    );
    this.meta = meta;
    this.insightsCache = null;
    this.emit('opened', { vault: this.vault, meta });
    return this.vault;
  }

  async remove(id: string): Promise<void> {
    await this.store.deleteVault(id);
    if (this.meta?.id === id) {
      this.vault = null;
      this.meta = null;
    }
  }

  /** Insights for the open vault, computed on first use and after changes. */
  insights(): Insights {
    const v = this.requireVault();
    if (!this.insightsCache || this.insightsCache.version !== v.version) this.insightsCache = computeInsights(v);
    return this.insightsCache;
  }

  cluster(paths: string[]): ClusterInfo {
    return clusterInfo(this.insights(), paths);
  }

  // ---------- writes (all persist) ----------

  async createNote(name: string, folder = '', content?: string): Promise<string> {
    const v = this.requireVault();
    const path = v.create(name, folder, content, { unique: true, now: this.clock() });
    await this.persist([path]);
    return path;
  }

  async saveNote(path: string, content: string): Promise<string> {
    const saved = this.requireVault().write(path, content, this.clock());
    await this.persist([saved]);
    return saved;
  }

  /** Link two notes, optionally with the reason for the connection. Returns the note that was written. */
  async link(from: string, to: string, reason = ''): Promise<string> {
    const written = this.requireVault().link(from, to, reason, this.clock());
    await this.persist([written]);
    return written;
  }

  async rename(path: string, newName: string): Promise<string[]> {
    const changed = this.requireVault().rename(path, newName, this.clock());
    if (changed.length) await this.persist(changed, [path]);
    return changed;
  }

  async deleteNote(path: string): Promise<void> {
    if (this.requireVault().remove(path)) await this.persist([], [path]);
  }

  async exportZip(): Promise<Uint8Array> {
    const meta = this.requireMeta();
    const files = await this.store.listFiles(meta.id);
    return writeZip(
      await Promise.all(
        files.map(async (f) => ({
          path: f.path,
          content: f.content,
          bytes: f.blob ? new Uint8Array(await f.blob.arrayBuffer()) : undefined,
          mtime: f.mtime,
        })),
      ),
    );
  }

  async attachmentUrl(path: string): Promise<string | null> {
    const f = await this.store.getFile(this.requireMeta().id, path);
    return f?.blob ? URL.createObjectURL(f.blob) : null;
  }

  getState<T>(key: string): Promise<T | undefined> {
    return this.store.getState<T>(this.requireMeta().id, key);
  }

  setState<T>(key: string, value: T): Promise<void> {
    return this.store.setState(this.requireMeta().id, key, value);
  }

  private async persist(written: string[], removed: string[] = []): Promise<void> {
    const v = this.requireVault();
    const meta = this.requireMeta();
    const files: StoredFile[] = written
      .map((p) => v.notes.get(p))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => ({ vaultId: meta.id, path: n.path, content: n.raw, mtime: n.mtime, ctime: n.ctime, size: n.raw.length }));
    const gone = removed.filter((p) => !written.includes(p));
    await this.store.putFiles(files);
    await this.store.deleteFiles(meta.id, gone);
    meta.updatedAt = this.clock();
    await this.store.putVault(meta);
    this.emit('changed', { paths: [...written, ...gone], version: v.version });
    this.scheduleInsights();
  }

  private scheduleInsights(): void {
    if (this.insightsTimer) clearTimeout(this.insightsTimer);
    this.insightsTimer = setTimeout(() => {
      this.insightsTimer = null;
      try {
        if (this.vault) this.emit('insights', this.insights());
      } catch (e) {
        this.emit('error', e instanceof Error ? e : new Error(String(e)));
      }
    }, 300);
  }

  private requireVault(): Vault {
    if (!this.vault) throw new Error('No vault is open');
    return this.vault;
  }

  private requireMeta(): StoredVault {
    if (!this.meta) throw new Error('No vault is open');
    return this.meta;
  }
}
