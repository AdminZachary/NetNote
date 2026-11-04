/**
 * The 2D page around the headset experience: pick or import a library, export it, choose a language
 * and step into VR or mixed reality. On a desktop it floats over the live 3D preview.
 * No native browser dialogs: confirmations and messages are drawn in the page.
 */
import { getLocale, setLocale, t, type Locale } from '../app/i18n';
import type { Library } from '../app/library';
import type { StoredVault } from '../storage/store';
import { readFileList } from '../storage/transfer';

export interface LandingDeps {
  library: Library;
  /** which immersive modes this browser offers */
  support: { vr: boolean; ar: boolean };
  enter(mode: 'vr' | 'ar'): void;
  /** open a library by id (also remembers it) */
  open(id: string): Promise<void>;
  onLocale(l: Locale): void;
}

const CSS = `
.tr-panel{position:fixed;top:16px;left:16px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;
  box-sizing:border-box;padding:22px 22px 18px;border-radius:20px;background:rgba(7,12,26,.86);backdrop-filter:blur(14px);
  -webkit-backdrop-filter:blur(14px);border:1px solid rgba(94,231,255,.25);box-shadow:0 20px 60px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.03);
  color:#e8f1ff;font:14px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;z-index:10;transition:transform .25s,opacity .25s}
.tr-panel.tr-hidden{transform:translateX(calc(-100% - 24px));opacity:0;pointer-events:none}
.tr-panel h1{margin:0 0 4px;font-size:24px;letter-spacing:.02em;background:linear-gradient(90deg,#5ee7ff,#b18cff);-webkit-background-clip:text;background-clip:text;color:transparent}
.tr-panel p{margin:0 0 14px;color:#9fb3d1}
.tr-row{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.tr-btn{appearance:none;border:1px solid rgba(94,231,255,.35);background:rgba(94,231,255,.08);color:#e8f1ff;border-radius:12px;padding:9px 14px;
  font:inherit;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s}
.tr-btn:hover{background:rgba(94,231,255,.18);border-color:rgba(94,231,255,.7)}
.tr-btn:disabled{opacity:.4;cursor:default}
.tr-btn.tr-primary{flex:1;padding:13px 16px;font-size:16px;background:linear-gradient(135deg,rgba(94,231,255,.35),rgba(177,140,255,.35));border-color:rgba(160,220,255,.7)}
.tr-btn.tr-danger{border-color:rgba(255,120,140,.5);background:rgba(255,90,120,.12)}
.tr-btn.tr-small{padding:5px 10px;font-size:12px;border-radius:9px}
.tr-h{margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#7f93b3}
.tr-lib{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.06);margin-bottom:6px;background:rgba(255,255,255,.02)}
.tr-lib.tr-on{border-color:rgba(94,231,255,.45);background:rgba(94,231,255,.07)}
.tr-lib .tr-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.tr-lib .tr-meta{font-size:12px;color:#7f93b3;font-weight:400}
.tr-note{font-size:12px;color:#7f93b3;margin:4px 0 0}
.tr-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
.tr-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(7,12,26,.92);
  border:1px solid rgba(94,231,255,.4);color:#e8f1ff;font:14px system-ui,sans-serif;z-index:20;opacity:0;transition:opacity .2s;pointer-events:none}
.tr-toast.tr-show{opacity:1}
.tr-toggle{position:fixed;top:16px;left:16px;z-index:9}
`;

export class Landing {
  readonly panel: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private confirming: string | null = null;
  private busy = false;
  private libs: StoredVault[] = [];
  private zipInput: HTMLInputElement;
  private dirInput: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: LandingDeps,
  ) {
    const doc = root.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);
    this.panel = doc.createElement('div');
    this.panel.className = 'tr-panel';
    this.panel.setAttribute('data-testid', 'landing');
    this.toastEl = doc.createElement('div');
    this.toastEl.className = 'tr-toast';
    this.toastEl.setAttribute('role', 'status');
    this.zipInput = this.fileInput('.zip,.md,.markdown,.canvas,.txt', true);
    this.dirInput = this.fileInput('', true);
    this.dirInput.setAttribute('webkitdirectory', '');
    root.append(this.panel, this.toastEl, this.zipInput, this.dirInput);
    deps.library.on('opened', () => void this.refresh());
    deps.library.on('changed', () => void this.refresh());
  }

  async refresh(): Promise<void> {
    this.libs = await this.deps.library.list();
    this.render();
  }

  set hidden(v: boolean) {
    this.panel.classList.toggle('tr-hidden', v);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('tr-show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('tr-show'), 2600);
  }

  render(): void {
    const tr = t();
    const lib = this.deps.library;
    const el = this.el.bind(this);
    const p = this.panel;
    p.replaceChildren();
    p.append(el('h1', tr.appName), el('p', tr.tagline));

    const enter = el('div', null, 'tr-row');
    const vr = this.button(tr.enterVR, () => this.deps.enter('vr'), 'tr-primary', 'enter-vr');
    vr.disabled = !this.deps.support.vr;
    const ar = this.button(tr.enterAR, () => this.deps.enter('ar'), 'tr-primary', 'enter-ar');
    ar.disabled = !this.deps.support.ar;
    enter.append(vr, ar);
    p.append(enter);
    if (!this.deps.support.vr && !this.deps.support.ar) p.append(el('p', tr.noXR, 'tr-note'));

    p.append(el('div', tr.vaults, 'tr-h'));
    for (const v of this.libs) {
      const row = el('div', null, 'tr-lib' + (lib.meta?.id === v.id ? ' tr-on' : ''));
      const name = el('div', null, 'tr-name');
      name.append(el('div', v.name), el('div', this.metaLine(v), 'tr-meta'));
      row.append(name);
      if (this.confirming === v.id) {
        row.append(
          this.button(tr.confirm, () => void this.remove(v.id), 'tr-small tr-danger', 'confirm-delete'),
          this.button(tr.cancel, () => this.setConfirm(null), 'tr-small'),
        );
      } else {
        if (lib.meta?.id !== v.id) row.append(this.button(tr.openLib, () => void this.deps.open(v.id), 'tr-small', 'open-lib'));
        row.append(this.button('✕', () => this.setConfirm(v.id), 'tr-small', 'delete-lib'));
      }
      p.append(row);
    }
    if (this.confirming) p.append(el('p', tr.confirmDelete, 'tr-note'));

    const tools = el('div', null, 'tr-row');
    tools.append(
      this.button(tr.importZip, () => this.zipInput.click(), '', 'import-zip'),
      this.button(tr.importFolder, () => this.dirInput.click(), '', 'import-folder'),
      this.button(tr.newVault, () => void this.createEmpty(), '', 'new-lib'),
      this.button(tr.exportZip, () => void this.exportZip(), '', 'export-zip'),
    );
    p.append(tools);
    p.append(el('p', tr.devices, 'tr-note'), el('p', tr.previewHint, 'tr-note'));

    const foot = el('div', null, 'tr-foot');
    foot.append(
      el('span', lib.vault ? `${lib.vault.notes.size} ${tr.notes}` : '', 'tr-note'),
      this.button(tr.language, () => this.toggleLocale(), 'tr-small', 'language'),
    );
    p.append(foot);
  }

  private metaLine(v: StoredVault): string {
    const lib = this.deps.library;
    const date = new Date(v.updatedAt).toLocaleDateString(getLocale() === 'zh' ? 'zh-CN' : 'en-GB');
    const count = lib.meta?.id === v.id && lib.vault ? ` · ${lib.vault.notes.size} ${t().notes}` : '';
    return date + count;
  }

  private setConfirm(id: string | null): void {
    this.confirming = id;
    this.render();
  }

  private toggleLocale(): void {
    const next: Locale = getLocale() === 'zh' ? 'en' : 'zh';
    setLocale(next);
    this.deps.onLocale(next);
    this.render();
  }

  private async remove(id: string): Promise<void> {
    const lib = this.deps.library;
    this.confirming = null;
    const wasOpen = lib.meta?.id === id;
    await lib.remove(id);
    this.libs = await lib.list();
    if (wasOpen && this.libs[0]) await this.deps.open(this.libs[0].id);
    else if (wasOpen) await this.createEmpty();
    this.render();
  }

  private async createEmpty(): Promise<void> {
    const tr = t();
    const name = `${tr.newVault} ${this.libs.length + 1}`;
    const id = await this.deps.library.add({
      name,
      origin: 'empty',
      files: [{ path: 'Welcome.md', content: tr.emptyWelcome(tr.newNoteTitle), mtime: Date.now() }],
    });
    await this.deps.open(id);
  }

  private async importFiles(files: FileList | null, label: string): Promise<void> {
    if (!files?.length || this.busy) return;
    this.busy = true;
    this.toast(t().importing);
    try {
      const imported = await readFileList(Array.from(files));
      const notes = imported.filter((f) => f.content !== undefined).length;
      if (!notes) {
        this.toast(t().importEmpty);
        return;
      }
      const first = files[0] as File & { webkitRelativePath?: string };
      const name = (first.webkitRelativePath?.split('/')[0] || label || first.name).replace(/\.zip$/i, '');
      const id = await this.deps.library.add({ name, origin: 'import', files: imported });
      await this.deps.open(id);
      this.toast(t().imported(notes));
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy = false;
    }
  }

  private async exportZip(): Promise<void> {
    const lib = this.deps.library;
    if (!lib.meta) return;
    const bytes = await lib.exportZip();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const a = this.root.ownerDocument.createElement('a');
    a.href = url;
    a.download = `${lib.meta.name.replace(/[\\/:*?"<>|]/g, '_')}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private fileInput(accept: string, multiple: boolean): HTMLInputElement {
    const i = this.root.ownerDocument.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.hidden = true;
    i.addEventListener('change', () => {
      void this.importFiles(i.files, '').finally(() => (i.value = ''));
    });
    return i;
  }

  private el(tag: string, text: string | null, cls = ''): HTMLElement {
    const e = this.root.ownerDocument.createElement(tag);
    if (text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  private button(label: string, fn: () => void, cls = '', testId = ''): HTMLButtonElement {
    const b = this.el('button', label, ('tr-btn ' + cls).trim()) as HTMLButtonElement;
    b.type = 'button';
    if (testId) b.setAttribute('data-testid', testId);
    b.addEventListener('click', fn);
    return b;
  }
}
