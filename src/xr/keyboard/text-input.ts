/**
 * Text entry through the Meta Quest system keyboard (WebXR), with the same code path for a Bluetooth
 * keyboard, voice dictation (the keyboard's mic key) and a desktop keyboard.
 *
 * How it works: the text being written lives in a real (invisible) text field. Focusing it opens the
 * Quest overlay keyboard, which shows the whole text with its own cursor: you can move the cursor
 * anywhere and insert, delete or select there. We read the field's value and cursor on every change
 * and draw them on our panel, so what you see in the room matches the keyboard.
 *
 * Safety net: some keyboard builds replace the whole value with the first key pressed. If a single
 * keystroke wipes out a longer text, we put the text back and add the keystroke at the cursor, so
 * nothing written is ever lost.
 */

export interface TextSessionState {
  text: string;
  /** cursor position in `text` */
  caret: number;
  keyboardOpen: boolean;
}

export type TextListener = (state: TextSessionState) => void;

export interface KeyboardEnv {
  document: Document;
  /** the active XR session, if any */
  session: () => XRSession | undefined;
}

/**
 * Did one keystroke replace a whole text instead of editing it? (`prev` → `next` with `data` typed.)
 * Returns the repaired text and cursor, or null when the edit looks normal.
 */
export function repairReplace(prev: string, prevCaret: number, next: string, data: string | null): { text: string; caret: number } | null {
  if (!data || prev.length < 3) return null;
  if (next !== data || next.length >= prev.length) return null;
  const at = Math.max(0, Math.min(prev.length, prevCaret));
  return { text: prev.slice(0, at) + data + prev.slice(at), caret: at + data.length };
}

/** Remove the word (and spaces) just before the cursor. */
export function deleteWordBefore(text: string, caret: number): { text: string; caret: number } {
  const head = text.slice(0, caret).replace(/(\s*\S+|\s+)$/u, '');
  return { text: head + text.slice(caret), caret: head.length };
}

export class TextInput {
  private field: HTMLTextAreaElement;
  private state: TextSessionState = { text: '', caret: 0, keyboardOpen: false };
  private listener: TextListener | null = null;
  private active = false;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onSelection: (() => void) | null = null;
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
    this.field.addEventListener('input', (e) => {
      const fixed = repairReplace(this.state.text, this.state.caret, this.field.value, (e as InputEvent).data ?? null);
      if (fixed) {
        this.field.value = fixed.text;
        this.field.setSelectionRange(fixed.caret, fixed.caret);
      }
      this.sync();
    });
    this.field.addEventListener('blur', () => {
      this.state.keyboardOpen = false;
      this.emit();
    });
    this.field.addEventListener('focus', () => {
      this.state.keyboardOpen = true;
      this.emit();
    });
  }

  get text(): string {
    return this.state.text;
  }

  get caret(): number {
    return this.state.caret;
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
    this.listener = listener;
    this.field.value = initial;
    this.state = { text: initial, caret: initial.length, keyboardOpen: false };
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
    // the cursor moves without an input event (arrow keys, the keyboard's cursor, a tap in its text)
    this.onSelection = (): void => {
      if (this.active && this.env.document.activeElement === this.field && this.field.selectionStart !== this.state.caret) this.sync();
    };
    this.env.document.addEventListener('keydown', this.onKey);
    this.env.document.addEventListener('selectionchange', this.onSelection);
    this.field.addEventListener('keyup', this.onSelection);
    this.emit();
  }

  /**
   * Open the keyboard with the whole text and the cursor where it was. Must run in response to a user
   * gesture (a pinch / trigger / click); the XR session's `select` event counts as one, so we also
   * retry from the next `select` if the browser ignored the first focus.
   */
  showKeyboard(): void {
    if (!this.active) return;
    const focus = (): void => {
      this.field.focus({ preventScroll: true });
      this.field.setSelectionRange(this.state.caret, this.state.caret);
    };
    focus();
    const s = this.env.session();
    if (s && this.env.document.activeElement !== this.field) {
      const retry = (): void => {
        s.removeEventListener('selectend', retry);
        if (this.active) focus();
      };
      s.addEventListener('selectend', retry);
    }
  }

  hideKeyboard(): void {
    this.field.blur();
  }

  /** Move the cursor (e.g. pinching a spot in the text on the panel). */
  setCaret(i: number): void {
    this.state.caret = Math.max(0, Math.min(this.state.text.length, i));
    this.field.setSelectionRange(this.state.caret, this.state.caret);
    this.emit();
  }

  /** Remove the word just before the cursor. */
  deleteWord(): void {
    const r = deleteWordBefore(this.state.text, this.state.caret);
    this.setValue(r.text, r.caret);
  }

  /** Replace the whole text (e.g. another block was chosen) without closing the keyboard. */
  setText(text: string): void {
    this.setValue(text, text.length);
  }

  clear(): void {
    this.setValue('', 0);
  }

  /** Finish and return the text. */
  end(): string {
    if (!this.active) return '';
    const out = this.field.value;
    this.active = false;
    this.listener = null;
    this.field.blur();
    this.field.value = '';
    if (this.onKey) this.env.document.removeEventListener('keydown', this.onKey);
    if (this.onSelection) {
      this.env.document.removeEventListener('selectionchange', this.onSelection);
      this.field.removeEventListener('keyup', this.onSelection);
    }
    this.onKey = this.onSelection = null;
    this.onSubmit = this.onCancel = null;
    this.state = { text: '', caret: 0, keyboardOpen: false };
    return out;
  }

  private setValue(text: string, caret: number): void {
    this.field.value = text;
    this.field.setSelectionRange(caret, caret);
    this.state.text = text;
    this.state.caret = caret;
    this.emit();
  }

  private sync(): void {
    this.state.text = this.field.value;
    this.state.caret = this.field.selectionStart ?? this.field.value.length;
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
