/**
 * Text entry through the Meta Quest system keyboard (WebXR), with the same code path for a Bluetooth
 * keyboard, voice dictation (the keyboard's mic key) and a desktop keyboard.
 *
 * How the Quest browser does it (developers.meta.com/horizon/documentation/web/webxr-keyboard):
 *   - `session.isSystemKeyboardSupported` tells whether the overlay keyboard exists;
 *   - focusing any DOM text field opens it; the session turns `visible-blurred` while it is up;
 *   - there are no key events, only the field's `value` (read it on `input`);
 *   - every time the keyboard opens, the first key press replaces the field's value.
 * So each keyboard session starts on an empty field and we append what was typed to our own buffer:
 * closing the keyboard half-way and opening it again never loses text.
 */

export interface TextSessionState {
  /** text committed in earlier keyboard sessions */
  committed: string;
  /** what the field holds right now */
  live: string;
  keyboardOpen: boolean;
}

export type TextListener = (state: TextSessionState) => void;

export interface KeyboardEnv {
  document: Document;
  /** the active XR session, if any */
  session: () => XRSession | undefined;
}

export class TextInput {
  private field: HTMLTextAreaElement;
  private state: TextSessionState = { committed: '', live: '', keyboardOpen: false };
  private listener: TextListener | null = null;
  private active = false;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  /** Enter (without Shift) and Escape on a physical keyboard. */
  onSubmit: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  multiline = true;

  constructor(private env: KeyboardEnv) {
    const doc = env.document;
    this.field = doc.createElement('textarea');
    this.field.setAttribute('aria-label', 'text input');
    this.field.setAttribute('autocapitalize', 'sentences');
    this.field.setAttribute('autocomplete', 'off');
    // On screen but invisible: an off-screen field makes the page scroll while typing (Meta's note).
    Object.assign(this.field.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      fontSize: '16px',
      border: '0',
      padding: '0',
      zIndex: '-1',
      pointerEvents: 'none',
    });
    doc.body.appendChild(this.field);
    this.field.addEventListener('input', () => {
      this.state.live = this.field.value;
      this.emit();
    });
    this.field.addEventListener('blur', () => this.commitLive(false));
    this.field.addEventListener('focus', () => {
      this.state.keyboardOpen = true;
      this.emit();
    });
  }

  get text(): string {
    return join(this.state.committed, this.state.live);
  }

  get isActive(): boolean {
    return this.active;
  }

  get keyboardOpen(): boolean {
    return this.state.keyboardOpen;
  }

  /** Is the Quest overlay keyboard available in the current session? */
  get systemKeyboard(): boolean {
    const s = this.env.session() as (XRSession & { isSystemKeyboardSupported?: boolean }) | undefined;
    return !!s?.isSystemKeyboardSupported;
  }

  /** Start a text session (does not open the keyboard yet: call `showKeyboard` from a pinch). */
  begin(initial: string, listener: TextListener, { multiline = true } = {}): void {
    this.end();
    this.active = true;
    this.multiline = multiline;
    this.state = { committed: initial, live: '', keyboardOpen: false };
    this.listener = listener;
    this.field.value = '';
    this.onKey = (e: KeyboardEvent): void => {
      if (!this.active || this.env.document.activeElement !== this.field) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onCancel?.();
      } else if (e.key === 'Enter' && (!this.multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.onSubmit?.();
      }
    };
    this.env.document.addEventListener('keydown', this.onKey);
    this.emit();
  }

  /**
   * Open the keyboard. Must run in response to a user gesture (a pinch / trigger / click); the XR
   * session's `select` event counts as one, so we also retry from the next `select` if the browser
   * ignored the first focus.
   */
  showKeyboard(): void {
    if (!this.active) return;
    this.commitLive(true);
    this.field.value = '';
    this.field.focus({ preventScroll: true });
    const s = this.env.session();
    if (s && this.env.document.activeElement !== this.field) {
      const retry = (): void => {
        s.removeEventListener('selectend', retry);
        if (this.active) this.field.focus({ preventScroll: true });
      };
      s.addEventListener('selectend', retry);
    }
  }

  hideKeyboard(): void {
    this.field.blur();
  }

  /** Remove the last word (there is no reliable backspace into earlier keyboard sessions). */
  deleteWord(): void {
    this.commitLive(true);
    this.state.committed = this.state.committed.replace(/(\s*\S+|\s+)$/u, '');
    this.emit();
  }

  clear(): void {
    this.field.value = '';
    this.state.committed = '';
    this.state.live = '';
    this.emit();
  }

  /** Finish and return the text. */
  end(): string {
    if (!this.active) return '';
    this.commitLive(true);
    const out = this.state.committed;
    this.active = false;
    this.listener = null;
    this.field.blur();
    this.field.value = '';
    if (this.onKey) this.env.document.removeEventListener('keydown', this.onKey);
    this.onKey = null;
    this.onSubmit = this.onCancel = null;
    return out;
  }

  private commitLive(keepOpen: boolean): void {
    if (this.state.live) {
      this.state.committed = join(this.state.committed, this.state.live);
      this.state.live = '';
      this.field.value = '';
    }
    if (!keepOpen) this.state.keyboardOpen = false;
    this.emit();
  }

  private emit(): void {
    this.listener?.({ ...this.state });
  }

  dispose(): void {
    this.end();
    this.field.remove();
  }
}

/** Join two pieces of typed text, adding a space between latin words but not inside CJK. */
export function join(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (/\s$/.test(a) || /^\s/.test(b) || /^[,.;:!?，。；：！？、)]/.test(b)) return a + b;
  const cjk = /[\u3000-鿿＀-￯]/;
  if (cjk.test(a[a.length - 1]!) || cjk.test(b[0]!)) return a + b;
  return a + ' ' + b;
}
