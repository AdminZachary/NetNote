import { describe, expect, it } from 'vitest';
import { completeLink, linkQueryAt, markdownToHtml } from '../../src/web/markdown-html';

describe('markdown to html', () => {
  it('renders the common blocks', () => {
    const h = markdownToHtml('---\ncreated: 2024-01-01\n---\n# Title\n\nA **bold** and *soft* word.\n\n- one\n- two\n\n> said\n\n```\n<b>x</b>\n```');
    expect(h).toContain('<h1>Title</h1>');
    expect(h).toContain('<strong>bold</strong>');
    expect(h).toContain('<em>soft</em>');
    expect(h).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(h).toContain('<blockquote>said</blockquote>');
    expect(h).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
    expect(h).not.toContain('created');
  });
  it('escapes everything a note could inject', () => {
    const h = markdownToHtml('<img src=x onerror=alert(1)> [[a" onclick="x]]');
    expect(h).not.toContain('<img');
    expect(h).not.toMatch(/onclick="x/);
  });
  it('turns wiki links into buttons, ghosts marked', () => {
    const h = markdownToHtml('See [[Sleep|sleep well]] and [[Nowhere]].', (t) => t === 'Sleep');
    expect(h).toContain('<button type="button" class="nn-wl" data-link="Sleep">sleep well</button>');
    expect(h).toContain('class="nn-wl nn-ghost" data-link="Nowhere"');
  });
});

describe('link autocomplete', () => {
  it('finds an unfinished [[ before the caret', () => {
    expect(linkQueryAt('see [[Sle', 9)).toEqual({ query: 'Sle', start: 4 });
    expect(linkQueryAt('see [[Sleep]] now', 17)).toBeNull();
    expect(linkQueryAt('no link', 7)).toBeNull();
  });
  it('completes it, swallowing a closing ]] already there', () => {
    expect(completeLink('see [[Sle', 4, 9, 'Sleep')).toEqual({ text: 'see [[Sleep]]', caret: 13 });
    expect(completeLink('see [[Sle]] x', 4, 9, 'Sleep')).toEqual({ text: 'see [[Sleep]] x', caret: 13 });
  });
});
