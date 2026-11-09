/**
 * Text entry through the Meta Quest system keyboard (WebXR), with the same code path for a Bluetooth
 * keyboard, voice dictation (the keyboard's mic key) and a desktop keyboard.
 *
 * Two ways the text field is used:
 *   - In the headset, the Quest overlay keyboard keeps its own little buffer and writes it into the
 *     field, replacing what was there. So the field never holds the note: it holds only what you are
 *     typing now, and we splice that in at the cursor (head + typed + tail). Pinch another spot in
 *     the text and the insertion point moves there. Nothing outside the insertion is ever touched.
 *   - On a desktop (a physical keyboard into the hidden field) the field holds the whole text and the
 *     browser's own cursor editing is used as is.
 *
 * Safety net (desktop): some keyboard builds replace the whole value with the first key pressed. If a
 * single keystroke wipes out a longer text, we put the text back and add the keystroke at the cursor.
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

/**
 * Typing into a text at an insertion point when the keyboard only knows its own buffer. `base` is what
 * the keyboard's buffer already held when the insertion point was set (it is not inserted again).
 */
export class InsertSegment {
  constructor(
    readonly head: string,
    readonly tail: string,
    private base = '',
  ) {}

  static at(text: string, caret: number, base = ''): InsertSegment {
    const c = Math.max(0, Math.min(text.length, caret));
    return new InsertSegment(text.slice(0, c), text.slice(c), base);
  }

  /** The keyboard's buffer is now `value` with its cursor at `sel`: the whole text and our cursor. */
  apply(value: string, sel: number): { text: string; caret: number; typed: string } {
    let typed: string;
    let cursor: number;
    if (value.startsWith(this.base)) {
      typed = value.slice(this.base.length);
      cursor = sel - this.base.length;
    } else if (this.base.startsWith(value)) {
      // backspacing into what was typed before the insertion point moved: nothing to insert here
      this.base = value;
      typed = '';
      cursor = 0;
    } else {
      // the keyboard started a fresh buffer
      this.base = '';
      typed = value;
      cursor = sel;
    }
    cursor = Math.max(0, Math.min(typed.length, cursor));
    return { text: this.head + typed + this.tail, caret: this.head.length + cursor, typed };
  }
}

export class TextInput {
  private field: HTMLTextAreaElement;
  private state: TextSessionState = { text: '', caret: 0, keyboardOpen: false };
  private listener: TextListener | null = null;
  private active = false;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onSelection: (() => void) | null = null;
  /** headset mode: where what you type goes in (null: the field holds the whole text) */
  private segment: InsertSegment | null = null;
  /** Enter (without Shift) and Escape on a physical keyboard. */
  onSubmit: (() => void) | null = null;
  onCancel: (() => void) | null = null;
  /** Any key or text arriving (a hardware, Bluetooth or surface keyboard, or the virtual one). */
  onTyped: (() => void) | null = null;
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
      this.onTyped?.();
      if (this.segment) return this.sync();
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
    this.segment = null;
    this.field.value = initial;
    this.state = { text: initial, caret: initial.length, keyboardOpen: false };
    this.onKey = (e: KeyboardEvent): void => {
      if (!this.active || this.env.document.activeElement !== this.field) return;
      this.onTyped?.();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onCancel?.();
      } else if ((e.key === 'Enter' && (!this.multiline || e.metaKey || e.ctrlKey)) || (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.onSubmit?.();
      }
    };
    // the cursor moves without an input event (arrow keys, the keyboard's cursor, a tap in its text)
    this.onSelection = (): void => {
      if (this.active && this.env.document.activeElement === this.field) this.sync();
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
    if (this.env.session()) {
      // headset: the keyboard writes its own buffer into the field; start it empty at the cursor
      if (!this.segment || this.env.document.activeElement !== this.field) {
        this.segment = InsertSegment.at(this.state.text, this.state.caret);
        this.field.value = '';
      }
    } else if (this.segment) {
      this.segment = null;
      this.field.value = this.state.text;
    }
    const focus = (): void => {
      this.field.focus({ preventScroll: true });
      const c = this.segment ? this.field.value.length : this.state.caret;
      this.field.setSelectionRange(c, c);
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
    if (this.segment) this.segment = InsertSegment.at(this.state.text, this.state.caret, this.field.value);
    else this.field.setSelectionRange(this.state.caret, this.state.caret);
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
    if (this.segment) this.sync();
    const out = this.segment ? this.state.text : this.field.value;
    this.segment = null;
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
    if (this.segment) this.segment = InsertSegment.at(text, caret, this.field.value);
    else {
      this.field.value = text;
      this.field.setSelectionRange(caret, caret);
    }
    this.state.text = text;
    this.state.caret = caret;
    this.emit();
  }

  private sync(): void {
    if (this.segment) {
      const r = this.segment.apply(this.field.value, this.field.selectionStart ?? this.field.value.length);
      this.state.text = r.text;
      this.state.caret = r.caret;
      this.emit();
      return;
    }
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
