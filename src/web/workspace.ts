/**
 * The 2D workspace: NetNote in a normal browser window (a desktop, or the Meta Quest browser before
 * you step inside). This is where long writing happens: real text fields, so every keyboard works,
 * including the Quest 3 surface keyboard on your desk, Bluetooth keyboards and voice. The headset
 * view is for seeing and connecting; this view is for writing and tidying.
 *
 * Layout: notes on the left, the note in the middle, its connections on the right (links to, linked
 * from, mentions that are not links yet, possibly related). Ergonomics for a headset browser window
 * as much as for a desktop: 17 px body text at 1.65 line height, lines no longer than ~72 characters,
 * every target at least 44 px tall, strong contrast, a visible focus ring, no native dialogs, and
 * nothing that moves unless you act (reduced motion honoured).
 */
import { getLocale, t } from '../app/i18n';
import type { Library } from '../app/library';
import { insightRows } from '../app/insight-rows';
import type { NoteView } from '../core/vault/vault';
import { GRAPH2D_CSS, Graph2D } from './graph2d';
import { completeLink, linkQueryAt, markdownToHtml } from './markdown-html';

export interface WorkspaceDeps {
  library: Library;
  support: { vr: boolean; ar: boolean };
  enter(mode: 'vr' | 'ar'): void;
  /** show / hide the library drawer (import, export, switch library) */
  toggleLibrary(): void;
  onLocale(): void;
  toast(text: string): void;
}

const CSS = `
.nn-ws{position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr;background:#070c1a;color:#e8f1ff;z-index:5;
  font:17px/1.65 "Inter","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.nn-ws .nn-g2{display:none}
.nn-ws.nn-graphing .nn-main,.nn-ws.nn-graphing .nn-side{display:none}
.nn-ws.nn-graphing .nn-g2{display:block;grid-column:2 / span 2;grid-row:1 / span 2}
.nn-ws.nn-off{display:none}
.nn-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(94,231,255,.16);min-height:64px;box-sizing:border-box;flex-wrap:wrap}
.nn-brand{font-weight:800;font-size:20px;letter-spacing:.02em;background:linear-gradient(90deg,#5ee7ff,#b18cff);-webkit-background-clip:text;background-clip:text;color:transparent;margin-right:6px}
.nn-search{flex:1 1 220px;min-width:160px;max-width:520px;height:44px;box-sizing:border-box;padding:0 14px;border-radius:12px;border:1px solid rgba(160,200,255,.22);
  background:rgba(255,255,255,.05);color:inherit;font:inherit}
.nn-spacer{flex:1}
.nn-btn{appearance:none;min-height:44px;padding:0 16px;border-radius:12px;border:1px solid rgba(94,231,255,.32);background:rgba(94,231,255,.08);color:#e8f1ff;
  font:inherit;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap}
.nn-btn:hover{background:rgba(94,231,255,.16);border-color:rgba(94,231,255,.6)}
.nn-btn:disabled{opacity:.4;cursor:default}
.nn-btn.nn-on{background:rgba(94,231,255,.22);border-color:#5ee7ff}
.nn-btn.nn-primary{background:linear-gradient(135deg,rgba(94,231,255,.32),rgba(177,140,255,.32));border-color:rgba(160,220,255,.75)}
.nn-btn.nn-danger{border-color:rgba(255,120,140,.55);background:rgba(255,90,120,.12)}
.nn-btn.nn-small{min-height:36px;padding:0 12px;font-size:14px}
.nn-ws :focus-visible{outline:3px solid #5ee7ff;outline-offset:2px}
.nn-body{display:grid;grid-template-columns:300px minmax(0,1fr) 320px;min-height:0}
.nn-col{min-height:0;overflow:auto}
.nn-list{border-right:1px solid rgba(94,231,255,.12);padding:10px}
.nn-item{display:block;width:100%;text-align:left;appearance:none;border:1px solid transparent;background:none;color:inherit;font:inherit;
  padding:10px 12px;border-radius:12px;cursor:pointer;min-height:44px}
.nn-item:hover{background:rgba(255,255,255,.04)}
.nn-item.nn-cur{background:rgba(94,231,255,.10);border-color:rgba(94,231,255,.35)}
.nn-item b{display:block;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nn-item small{display:block;color:#8ea3c4;font-size:13.5px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nn-count{color:#7f93b3;font-size:13.5px;padding:4px 12px 8px}
.nn-main{padding:18px 28px 28px;display:flex;flex-direction:column;align-items:center}
.nn-doc{width:100%;max-width:760px;display:flex;flex-direction:column;gap:12px;flex:1;min-height:0}
.nn-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nn-title{flex:1 1 240px;min-width:0;height:52px;box-sizing:border-box;padding:0 14px;border-radius:12px;border:1px solid transparent;background:transparent;color:#fff;
  font:inherit;font-size:26px;font-weight:750}
.nn-title:hover,.nn-title:focus{border-color:rgba(160,200,255,.22);background:rgba(255,255,255,.04)}
.nn-status{font-size:13.5px;color:#8ea3c4;min-width:84px;text-align:right}
.nn-text{flex:1;min-height:260px;width:100%;box-sizing:border-box;resize:none;padding:18px 20px;border-radius:14px;border:1px solid rgba(160,200,255,.18);
  background:rgba(255,255,255,.035);color:#eef4ff;font:inherit;font-size:17px;line-height:1.7;caret-color:#5ee7ff;tab-size:2}
.nn-text:focus{border-color:rgba(94,231,255,.55)}
.nn-read{flex:1;padding:6px 6px 24px;max-width:72ch}
.nn-read h1,.nn-read h2,.nn-read h3{line-height:1.3;margin:1.2em 0 .5em}
.nn-read p,.nn-read li{color:#dbe6f7}
.nn-read code{background:rgba(255,255,255,.07);padding:1px 6px;border-radius:6px;font-size:.92em}
.nn-read pre{background:rgba(255,255,255,.05);padding:12px 14px;border-radius:10px;overflow:auto}
.nn-read blockquote{margin:.6em 0;padding:.2em 1em;border-left:3px solid #b18cff;color:#c6d3ea}
.nn-read a{color:#8fdcff}
.nn-wl{appearance:none;border:0;background:none;padding:0 1px;font:inherit;color:#5ee7ff;cursor:pointer;border-bottom:1px solid rgba(94,231,255,.45)}
.nn-wl.nn-ghost{color:#ffd166;border-bottom-style:dashed}
.nn-tag{color:#b18cff}
.nn-hint{font-size:13.5px;color:#7f93b3}
.nn-pick{flex:1;display:flex;flex-direction:column;min-height:0}
.nn-foot{min-height:52px;display:flex;align-items:center}
.nn-pop{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nn-pop .nn-lbl{font-size:13.5px;color:#ffd166;margin-right:2px}
.nn-chip{appearance:none;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid rgba(255,209,102,.45);background:rgba(255,209,102,.08);color:#ffe7ae;
  font:inherit;font-size:15px;cursor:pointer;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nn-chip.nn-sel{background:rgba(255,209,102,.24);border-color:#ffd166;color:#fff}
.nn-side{border-left:1px solid rgba(94,231,255,.12);padding:14px 14px 24px}
.nn-h{margin:16px 6px 6px;font-size:12.5px;text-transform:uppercase;letter-spacing:.12em;color:#7f93b3}
.nn-h:first-child{margin-top:4px}
.nn-link{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;min-height:44px;box-sizing:border-box}
.nn-link:hover{background:rgba(255,255,255,.04)}
.nn-link .nn-go{flex:1;min-width:0;text-align:left;appearance:none;border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:0}
.nn-link .nn-go b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nn-link .nn-go small{display:block;color:#8ea3c4;font-size:13px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.nn-empty{color:#8ea3c4;padding:6px 10px;font-size:14.5px}
.nn-confirm{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,120,140,.45);background:rgba(255,90,120,.08);flex-wrap:wrap}
.nn-tabs{display:none}
@media (max-width:1100px){.nn-body{grid-template-columns:260px minmax(0,1fr)}.nn-side{grid-column:2;border-left:0;border-top:1px solid rgba(94,231,255,.12)}
  .nn-main{grid-row:1}.nn-body{grid-template-rows:auto auto;overflow:auto;align-content:start}.nn-col{overflow:visible;min-height:auto}
  .nn-doc,.nn-pick{flex:none}.nn-text{flex:none;height:56vh}.nn-list{grid-row:1 / span 2;overflow:auto;max-height:calc(100vh - 64px);position:sticky;top:0}}
@media (max-width:720px){.nn-ws.nn-graphing .nn-list{display:none}.nn-ws.nn-graphing .nn-g2{grid-column:1}.nn-body{grid-template-columns:minmax(0,1fr)}.nn-title{flex-basis:100%;font-size:22px}.nn-bar .nn-status{text-align:left;flex:1}.nn-list{border-right:0}.nn-side{grid-column:1}
  .nn-list{grid-row:auto;position:static;max-height:none}
  .nn-ws[data-pane=list] .nn-main,.nn-ws[data-pane=list] .nn-side{display:none}.nn-ws[data-pane=note] .nn-list{display:none}
  .nn-top{gap:8px;padding:8px 12px}.nn-search{order:9;flex-basis:100%;max-width:none}.nn-spacer{display:none}
  .nn-tabs{display:inline-flex}.nn-main{padding:12px 16px}}
@media (prefers-reduced-motion:no-preference){.nn-btn,.nn-item{transition:background .15s,border-color .15s}}
`;

interface LinkRow {
  path: string | null;
  name: string;
  sub?: string;
  action?: { label: string; run: () => void };
}

export class Workspace {
  readonly root: HTMLDivElement;
  current: string | null = null;
  private mode: 'edit' | 'read' = 'edit';
  private query = '';
  private dirty = false;
  private saving = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmDelete = false;
  private graphing = false;
  readonly graph: Graph2D;
  private els: {
    search: HTMLInputElement;
    list: HTMLDivElement;
    main: HTMLDivElement;
    side: HTMLDivElement;
    top: HTMLDivElement;
    title?: HTMLInputElement;
    text?: HTMLTextAreaElement;
    status?: HTMLSpanElement;
    pop?: HTMLDivElement;
    foot?: HTMLDivElement;
  };
  private pick: { start: number; items: { path: string; name: string }[]; sel: number } | null = null;

  constructor(
    host: HTMLElement,
    private readonly deps: WorkspaceDeps,
  ) {
    const doc = host.ownerDocument;
    const style = doc.createElement('style');
    style.textContent = CSS + GRAPH2D_CSS;
    doc.head.appendChild(style);
    this.root = doc.createElement('div');
    this.root.className = 'nn-ws';
    this.root.dataset.testid = 'workspace';
    this.root.setAttribute('data-testid', 'workspace');
    this.root.dataset.pane = 'list';
    const top = this.div('nn-top');
    const body = this.div('nn-body');
    const list = this.div('nn-col nn-list');
    const main = this.div('nn-col nn-main');
    const side = this.div('nn-col nn-side');
    this.graph = new Graph2D(deps.library);
    this.graph.onOpen = (id) => void this.openFromGraph(id);
    body.append(list, main, side, this.graph.root);
    const search = doc.createElement('input');
    search.className = 'nn-search';
    search.type = 'search';
    search.setAttribute('data-testid', 'ws-search');
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList();
      if (this.graphing) this.syncGraph();
    });
    this.els = { search, list, main, side, top };
    this.root.append(top, body);
    host.appendChild(this.root);
    const lib = deps.library;
    lib.on('opened', () => {
      this.current = null;
      this.render();
      if (this.graphing) this.syncGraph();
    });
    lib.on('changed', () => this.onLibraryChanged());
    lib.on('insights', () => this.renderSide());
    doc.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('nn-off')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.saveNow();
      }
    });
  }

  set hidden(v: boolean) {
    if (v) void this.saveNow();
    this.root.classList.toggle('nn-off', v);
  }

  get hidden(): boolean {
    return this.root.classList.contains('nn-off');
  }

  render(): void {
    this.renderTop();
    this.renderList();
    this.renderMain();
    this.renderSide();
  }

  /** Open a note in the middle (saving the one being written first). */
  async open(path: string | null): Promise<void> {
    if (this.graphing && path) this.setGraph(false);
    if (path === this.current) return;
    await this.saveNow();
    this.current = path;
    this.confirmDelete = false;
    this.root.dataset.pane = path ? 'note' : 'list';
    this.renderList();
    this.renderMain();
    this.renderSide();
  }

  // ---------- top bar ----------

  private renderTop(): void {
    const tr = t();
    const top = this.els.top;
    top.replaceChildren();
    const brand = this.div('nn-brand', tr.appName);
    const back = this.button(tr.wsBackToNotes, () => (this.root.dataset.pane = 'list'), 'nn-small nn-tabs');
    this.els.search.placeholder = tr.wsSearch;
    this.els.search.setAttribute('aria-label', tr.wsSearch);
    const add = this.button(tr.wsNew, () => void this.newNote(), 'nn-primary', 'ws-new');
    const graph = this.button(tr.wsGraph, () => this.setGraph(!this.graphing), this.graphing ? 'nn-on' : '', 'ws-graph');
    graph.setAttribute('aria-pressed', String(this.graphing));
    const libBtn = this.button(tr.wsLibrary, () => this.deps.toggleLibrary(), '', 'ws-library');
    const lang = this.button(getLocale() === 'zh' ? 'EN' : '中文', () => this.deps.onLocale(), 'nn-small', 'language');
    const vr = this.button(tr.enterVR, () => this.deps.enter('vr'), 'nn-primary', 'enter-vr');
    vr.disabled = !this.deps.support.vr;
    const ar = this.button(tr.enterAR, () => this.deps.enter('ar'), 'nn-primary', 'enter-ar');
    ar.disabled = !this.deps.support.ar;
    if (!this.deps.support.vr && !this.deps.support.ar) vr.title = ar.title = tr.noXR;
    top.append(brand, back, this.els.search, add, this.div('nn-spacer'), graph, libBtn, lang, vr, ar);
  }

  /** Show the star map (a flat 2D map here; the 3D one is for the headset) in place of the note. */
  setGraph(on: boolean): void {
    this.graphing = on;
    if (on) void this.saveNow();
    this.root.classList.toggle('nn-graphing', on);
    this.renderTop();
    if (on) {
      this.root.dataset.pane = 'note';
      this.syncGraph();
      if (this.current) this.graph.centreOn(this.current);
    }
  }

  get graphShown(): boolean {
    return this.graphing;
  }

  private syncGraph(): void {
    const vault = this.deps.library.vault;
    const q = this.query.trim();
    this.graph.focus = this.current;
    this.graph.matches = q && vault ? new Set(vault.search(q, 200).map((h) => h.path)) : null;
    this.graph.refresh();
  }

  private async openFromGraph(id: string): Promise<void> {
    const vault = this.deps.library.vault;
    if (!vault) return;
    this.setGraph(false);
    if (vault.notes.has(id)) {
      await this.open(id);
      return;
    }
    // an unwritten note (a link to nothing yet): write it now
    const name = vault.graph().nodes.find((n) => n.id === id)?.name ?? id;
    const path = await this.deps.library.createNote(name.replace(/\.md$/i, ''), '', `# ${name}\n\n`);
    this.mode = 'edit';
    await this.open(path);
  }

  // ---------- notes list ----------

  private renderList(): void {
    const tr = t();
    const vault = this.deps.library.vault;
    const list = this.els.list;
    list.replaceChildren();
    if (!vault) return;
    const q = this.query.trim();
    const rows: { path: string; name: string; sub: string }[] = q
      ? vault.search(q, 80).map((h) => ({ path: h.path, name: h.name, sub: h.snippet }))
      : [...vault.notes.values()]
          .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
          .map((n) => ({ path: n.path, name: n.name, sub: firstLine(n.content, n.name) || n.folder }));
    list.append(this.div('nn-count', tr.wsCount(rows.length)));
    for (const r of rows) {
      const b = this.el('button', 'nn-item' + (r.path === this.current ? ' nn-cur' : '')) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('data-path', r.path);
      const name = this.el('b');
      name.textContent = r.name;
      const sub = this.el('small');
      sub.textContent = r.sub;
      b.append(name, sub);
      b.addEventListener('click', () => void this.open(r.path));
      list.append(b);
    }
  }

  // ---------- the note ----------

  private renderMain(): void {
    const tr = t();
    const main = this.els.main;
    main.replaceChildren();
    this.els.title = this.els.text = this.els.status = this.els.pop = this.els.foot = undefined;
    const note = this.current ? this.deps.library.vault?.notes.get(this.current) : undefined;
    const doc = this.div('nn-doc');
    main.append(doc);
    if (!note) {
      doc.append(this.div('nn-empty', tr.wsEmpty));
      return;
    }
    const bar = this.div('nn-bar');
    const title = this.el('input', 'nn-title') as HTMLInputElement;
    title.value = note.name;
    title.setAttribute('aria-label', tr.wsTitle);
    title.setAttribute('data-testid', 'ws-title');
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        title.blur();
      } else if (e.key === 'Escape') {
        title.value = note.name;
        title.blur();
      }
    });
    title.addEventListener('change', () => void this.rename(title.value));
    const status = this.el('span', 'nn-status') as HTMLSpanElement;
    status.setAttribute('aria-live', 'polite');
    const editBtn = this.button(tr.wsEdit, () => this.setMode('edit'), 'nn-small' + (this.mode === 'edit' ? ' nn-on' : ''), 'ws-edit');
    const readBtn = this.button(tr.wsPreview, () => this.setMode('read'), 'nn-small' + (this.mode === 'read' ? ' nn-on' : ''), 'ws-read');
    const del = this.button(tr.wsDelete, () => this.askDelete(), 'nn-small nn-danger', 'ws-delete');
    bar.append(title, status, editBtn, readBtn, del);
    doc.append(bar);
    this.els.title = title;
    this.els.status = status;
    if (this.confirmDelete) {
      const c = this.div('nn-confirm');
      c.append(
        this.div('', tr.wsDeleteAsk),
        this.button(tr.confirm, () => void this.remove(), 'nn-small nn-danger', 'ws-confirm-delete'),
        this.button(
          tr.cancel,
          () => {
            this.confirmDelete = false;
            this.renderMain();
          },
          'nn-small',
        ),
      );
      doc.append(c);
    }
    if (this.mode === 'read') {
      const read = this.div('nn-read');
      // the title is already shown above: leave out a first heading that only repeats it
      const shown = note.raw.replace(/^(\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?)?\s*#\s+(.+)\r?\n/, (m, fm: string | undefined, h: string) =>
        h.trim() === note.name ? (fm ?? '') : m,
      );
      read.innerHTML = markdownToHtml(shown, (target) => !!this.deps.library.vault?.resolve(target, note.path));
      read.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-link]') as HTMLElement | null;
        if (b) void this.follow(b.dataset.link ?? '');
      });
      doc.append(read);
    } else {
      const wrap = this.div('nn-pick');
      const text = this.el('textarea', 'nn-text') as HTMLTextAreaElement;
      text.value = note.raw;
      text.spellcheck = true;
      text.setAttribute('data-testid', 'ws-text');
      text.setAttribute('aria-label', note.name);
      text.addEventListener('input', () => {
        this.dirty = true;
        this.showStatus();
        this.scheduleSave();
        this.updatePick();
      });
      text.addEventListener('keydown', (e) => this.onTextKey(e));
      text.addEventListener('click', () => this.updatePick());
      text.addEventListener('blur', () => setTimeout(() => this.closePick(), 150));
      wrap.append(text);
      doc.append(wrap);
      this.els.text = text;
      // under the text: the hint, or (while you type a [[link) the notes you can link, as big chips
      // in a fixed place, so nothing ever covers what you are writing
      const foot = this.div('nn-foot');
      foot.append(this.div('nn-hint', tr.wsHint));
      doc.append(foot);
      this.els.foot = foot;
    }
    this.showStatus();
  }

  private setMode(m: 'edit' | 'read'): void {
    if (m === this.mode) return;
    void this.saveNow();
    this.mode = m;
    this.renderMain();
  }

  private showStatus(): void {
    const s = this.els.status;
    if (!s) return;
    const tr = t();
    s.textContent = this.saving ? tr.wsSaving : this.dirty ? tr.wsUnsaved : tr.wsSaved;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), 900);
  }

  /** Write what is in the text box (if it changed). */
  async saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const text = this.els.text;
    const path = this.current;
    if (!this.dirty || !text || !path) return;
    this.dirty = false;
    this.saving = true;
    this.showStatus();
    try {
      await this.deps.library.saveNote(path, text.value);
    } catch (e) {
      this.dirty = true;
      this.deps.toast(e instanceof Error ? e.message : String(e));
    } finally {
      this.saving = false;
      this.showStatus();
    }
  }

  /** The library changed (here, in the headset, or by an import): refresh without losing typing. */
  private onLibraryChanged(): void {
    const vault = this.deps.library.vault;
    if (this.current && !vault?.notes.has(this.current)) this.current = null;
    if (this.graphing) this.syncGraph();
    this.renderList();
    this.renderSide();
    const note = this.current ? vault?.notes.get(this.current) : undefined;
    const text = this.els.text;
    if (!note || !this.els.title) {
      this.renderMain();
      return;
    }
    if (this.els.title !== this.root.ownerDocument.activeElement) this.els.title.value = note.name;
    // someone else changed the note we are on, and we have nothing unsaved: show their version
    if (text && !this.dirty && !this.saving && text.value !== note.raw) {
      const at = text.selectionStart;
      text.value = note.raw;
      text.setSelectionRange(Math.min(at, note.raw.length), Math.min(at, note.raw.length));
    }
    if (this.mode === 'read') this.renderMain();
  }

  private async newNote(): Promise<void> {
    await this.saveNow();
    const tr = t();
    const vault = this.deps.library.vault;
    if (!vault) return;
    let name = tr.newNoteTitle;
    for (let i = 2; [...vault.notes.values()].some((n) => n.name === name); i++) name = `${tr.newNoteTitle} ${i}`;
    const path = await this.deps.library.createNote(name, 'Inbox', `# ${name}\n\n`);
    this.mode = 'edit';
    await this.open(path);
    const title = this.els.title;
    if (title) {
      title.focus();
      title.select();
    }
  }

  private async rename(to: string): Promise<void> {
    const path = this.current;
    const name = to.trim();
    const note = path ? this.deps.library.vault?.notes.get(path) : undefined;
    if (!path || !note || !name || name === note.name) {
      if (this.els.title && note) this.els.title.value = note.name;
      return;
    }
    await this.saveNow();
    try {
      const changed = await this.deps.library.rename(path, name);
      const now = changed[0];
      this.deps.toast(t().renamed(changed.length));
      if (now) {
        this.current = now;
        this.render();
      }
    } catch (e) {
      this.deps.toast(e instanceof Error ? e.message : String(e));
      if (this.els.title) this.els.title.value = note.name;
    }
  }

  private askDelete(): void {
    this.confirmDelete = true;
    this.renderMain();
  }

  private async remove(): Promise<void> {
    const path = this.current;
    if (!path) return;
    this.dirty = false;
    this.confirmDelete = false;
    await this.deps.library.deleteNote(path);
    this.current = null;
    this.deps.toast(t().deleted);
    this.root.dataset.pane = 'list';
    this.render();
  }

  /** Open the note a wiki link points to, or write it if it does not exist yet. */
  private async follow(target: string): Promise<void> {
    const vault = this.deps.library.vault;
    if (!vault) return;
    const to = vault.resolve(target, this.current ?? '');
    if (to) await this.open(to);
    else {
      const path = await this.deps.library.createNote(target.replace(/\.md$/i, ''), '', `# ${target}\n\n`);
      this.mode = 'edit';
      await this.open(path);
    }
  }

  // ---------- [[ link picker ----------

  private updatePick(): void {
    const text = this.els.text;
    const vault = this.deps.library.vault;
    if (!text || !vault) return;
    const q = linkQueryAt(text.value, text.selectionStart);
    if (!q) return this.closePick();
    const hits = q.query.trim()
      ? vault.search(q.query, 8).map((h) => ({ path: h.path, name: h.name }))
      : [...vault.notes.values()]
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 8)
          .map((n) => ({ path: n.path, name: n.name }));
    const items = hits.filter((h) => h.path !== this.current).slice(0, 6);
    if (!items.length) return this.closePick();
    this.pick = { start: q.start, items, sel: Math.min(this.pick?.sel ?? 0, items.length - 1) };
    this.drawPick();
  }

  private drawPick(): void {
    const p = this.pick;
    const foot = this.els.foot;
    if (!p || !foot) return;
    const pop = this.div('nn-pop');
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', t().wsLinkPick);
    pop.setAttribute('data-testid', 'ws-link-pop');
    pop.append(this.div('nn-lbl', t().wsLinkPick));
    p.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nn-chip' + (i === p.sel ? ' nn-sel' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === p.sel));
      b.textContent = it.name;
      // pointerdown, not click: keep the focus (and the caret) in the text box
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.choosePick(i);
      });
      pop.append(b);
    });
    foot.replaceChildren(pop);
    this.els.pop = pop;
  }

  private closePick(): void {
    this.pick = null;
    if (this.els.pop && this.els.foot) this.els.foot.replaceChildren(this.div('nn-hint', t().wsHint));
    this.els.pop = undefined;
  }

  private choosePick(i: number): void {
    const p = this.pick;
    const text = this.els.text;
    const it = p?.items[i];
    if (!p || !text || !it) return;
    const r = completeLink(text.value, p.start, text.selectionStart, it.name);
    text.value = r.text;
    text.setSelectionRange(r.caret, r.caret);
    text.focus();
    this.closePick();
    this.dirty = true;
    this.showStatus();
    this.scheduleSave();
  }

  private onTextKey(e: KeyboardEvent): void {
    const p = this.pick;
    if (!p) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      p.sel = (p.sel + (e.key === 'ArrowDown' ? 1 : -1) + p.items.length) % p.items.length;
      this.drawPick();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      this.choosePick(p.sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.closePick();
    }
  }

  // ---------- connections ----------

  private renderSide(): void {
    const tr = t();
    const side = this.els.side;
    side.replaceChildren();
    const lib = this.deps.library;
    const vault = lib.vault;
    const path = this.current;
    const view: NoteView | null = path && vault ? vault.view(path) : null;
    if (!view || !path) return;
    const section = (title: string, rows: LinkRow[], testId: string): void => {
      side.append(this.div('nn-h', title));
      const box = this.div('');
      box.setAttribute('data-testid', testId);
      if (!rows.length) box.append(this.div('nn-empty', '—'));
      for (const r of rows) box.append(this.linkRow(r));
      side.append(box);
    };
    section(
      tr.wsLinksOut,
      view.outgoing
        .filter((o) => !o.file)
        .map((o) => ({
          path: o.path,
          name: o.name,
          sub: o.exists ? undefined : tr.wsUnwritten,
          action: o.exists ? undefined : { label: tr.wsCreate, run: () => void this.follow(o.target) },
        })),
      'ws-out',
    );
    if (!view.outgoing.length && !view.backlinks.length) side.append(this.div('nn-empty', tr.wsNothing));
    section(
      tr.wsLinksIn,
      view.backlinks.map((b) => ({ path: b.path, name: b.name, sub: b.contexts[0] })),
      'ws-in',
    );
    section(
      tr.wsMentions,
      view.mentions.map((m) => ({ path: m.path, name: m.name, sub: m.context, action: { label: tr.wsConnect, run: () => void this.connect(m.path, path) } })),
      'ws-mentions',
    );
    let related: LinkRow[] = [];
    try {
      const ins = lib.insights();
      const name = (id: string): string => vault?.notes.get(id)?.name ?? id;
      related = insightRows(ins, 'links', {
        name,
        linked: (a, b) => !!vault && vault.view(a)?.outgoing.some((o) => o.path === b) === true,
        exists: (id) => !!vault?.notes.has(id),
        dismissed: new Set(),
      })
        .filter((r) => r.pair && r.pair.includes(path))
        .slice(0, 6)
        .map((r) => {
          const other = r.pair![0] === path ? r.pair![1] : r.pair![0];
          return { path: other, name: name(other), sub: r.sub, action: { label: tr.wsConnect, run: () => void this.connect(path, other) } };
        });
    } catch {
      related = [];
    }
    section(tr.wsRelated, related, 'ws-related');
  }

  private linkRow(r: LinkRow): HTMLElement {
    const row = this.div('nn-link');
    const go = this.el('button', 'nn-go') as HTMLButtonElement;
    go.type = 'button';
    const b = this.el('b');
    b.textContent = r.name;
    go.append(b);
    if (r.sub) {
      const s = this.el('small');
      s.textContent = r.sub;
      go.append(s);
    }
    if (r.path) go.addEventListener('click', () => void this.open(r.path));
    else go.disabled = true;
    row.append(go);
    if (r.action) row.append(this.button(r.action.label, r.action.run, 'nn-small'));
    return row;
  }

  private async connect(from: string, to: string): Promise<void> {
    await this.saveNow();
    await this.deps.library.link(from, to);
    this.deps.toast(t().wsConnected);
  }

  // ---------- helpers ----------

  private el(tag: string, cls = ''): HTMLElement {
    const e = this.root?.ownerDocument.createElement(tag) ?? document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  private div(cls: string, text?: string): HTMLDivElement {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (text !== undefined) d.textContent = text;
    return d;
  }

  private button(label: string, fn: () => void, cls = '', testId = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = ('nn-btn ' + cls).trim();
    b.textContent = label;
    if (testId) b.setAttribute('data-testid', testId);
    b.addEventListener('click', fn);
    return b;
  }
}

/** The first line of a note worth showing under its name (skipping the title heading). */
function firstLine(content: string, name: string): string {
  for (const l of content.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').split('\n')) {
    if (/^#\s/.test(l)) continue;
    const s = l.replace(/^#+\s*|^[-*+]\s+|^>\s*/g, '').trim();
    if (s && s !== name) return s.length > 90 ? s.slice(0, 90) + '…' : s;
  }
  return '';
}
