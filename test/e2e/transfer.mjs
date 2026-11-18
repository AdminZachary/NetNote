/**
 * Getting notes in and out, end to end in a real browser: export the library as a .zip, import a
 * folder, a .zip and loose Markdown files, and check that a round trip gives back the same files.
 *
 *   node test/e2e/transfer.mjs        (starts its own dev server on port 8092)
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const PORT = 8092;
const URL_ = process.env.E2E_URL || `https://localhost:${PORT}/?notour`;
const results = [];
let failed = false;
function check(name, ok, detail = '') {
  results.push(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
}

async function launch() {
  // the browser needs a UTF-8 locale to open files with non-ASCII names
  const env = { ...process.env, LANG: process.env.LANG || 'C.UTF-8' };
  const args = ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  try {
    return await chromium.launch({ args, env });
  } catch {
    return chromium.launch({ args, env, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  }
}

async function ready(page) {
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.netnote?.library.vault, null, { timeout: 60000 });
  await page.waitForTimeout(800);
}

const openDrawer = async (page) => {
  if (!(await page.isVisible('[data-testid=import-zip]'))) await page.click('[data-testid=ws-library]');
  await page.waitForSelector('[data-testid=import-zip]', { state: 'visible' });
};

/** The open library as { path: text-or-bytes-length } */
const snapshot = (page) =>
  page.evaluate(async () => {
    const lib = window.netnote.library;
    const v = lib.vault;
    const out = {};
    for (const [p, n] of v.notes) out[p] = n.raw;
    return { name: lib.meta.name, notes: out, links: v.graph().links.length };
  });

async function exportZip(page, dir, label) {
  await openDrawer(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=export-zip]')]);
  const file = path.join(dir, `${label}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), entries: unzipSync(new Uint8Array(fs.readFileSync(file))) };
}

async function waitForLibrary(page, name) {
  try {
    await page.waitForFunction((n) => window.netnote.library.meta?.name === n, name, { timeout: 20000 });
  } catch {
    const why = await page.evaluate(() => ({ open: window.netnote.library.meta?.name, toast: document.querySelector('.tr-toast')?.textContent }));
    throw new Error(`library "${name}" did not open: ${JSON.stringify(why)}`);
  }
  await page.waitForTimeout(500);
}

// a small vault on disk: nested folders, a Chinese name, links, an image, a BOM, and things to skip
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'netnote-transfer-'));
const SRC = path.join(TMP, 'Research vault');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);
const files = {
  'Index.md': '# Index\n\nStart at [[Sleep]] and [[睡眠与记忆]].\n\n![[diagram.png]]\n',
  'Topics/Sleep.md': '---\ncreated: 2026-10-01\ntags: [sleep]\n---\n# Sleep\n\nSee [[Memory#Consolidation|consolidation]] and [[Index]].\n',
  'Topics/Memory.md': '# Memory\n\n## Consolidation\n\nLinks back to [[Sleep]].\n',
  'Topics/深/睡眠与记忆.md': '# 睡眠与记忆\n\n睡眠帮助巩固记忆，见 [[Memory]]。\n',
  'Inbox/bom.md': '\ufeff# With a BOM\n\nPlain text.\n',
  'diagram.png': PNG,
  '.obsidian/workspace.json': '{}',
  '.DS_Store': 'x',
  'Topics/.hidden.md': '# hidden\n',
};
for (const [p, c] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(SRC, p)), { recursive: true });
  fs.writeFileSync(path.join(SRC, p), c);
}
const KEPT = ['Index.md', 'Topics/Sleep.md', 'Topics/Memory.md', 'Topics/深/睡眠与记忆.md', 'Inbox/bom.md', 'diagram.png'];
const stripBom = (s) => s.replace(/^\ufeff/, '');

const server = process.env.E2E_URL ? null : await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server?.listen();
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, locale: 'en-US', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);

  // 1. export the sample library after an edit: the zip holds every note and the edit
  const sample = await snapshot(page);
  await page.evaluate(() => window.netnote.library.saveNote('Walking.md', '# Walking\n\nEdited before export: ünïcødé ✓ 中文\n'));
  await page.evaluate(() => window.netnote.library.createNote('Brand new idea', '', '# Brand new idea\n\nLinks to [[Walking]].\n'));
  const ex1 = await exportZip(page, TMP, 'sample');
  const md1 = Object.keys(ex1.entries).filter((p) => p.endsWith('.md'));
  check('export: the sample library downloads as a .zip named after it', ex1.name.endsWith('.zip'), ex1.name);
  check('export: every note is in the zip, plus the new one', md1.length === Object.keys(sample.notes).length + 1, `${md1.length} notes`);
  check('export: an edit made just before is in the zip, Unicode intact', strFromU8(ex1.entries['Walking.md'] ?? new Uint8Array()).includes('ünïcødé ✓ 中文'));
  check('export: a note created in the app is in the zip', !!ex1.entries['Brand new idea.md']);

  // 2. import a folder (as the folder picker gives it)
  await openDrawer(page);
  await page.setInputFiles('input[type=file][webkitdirectory]', SRC);
  await waitForLibrary(page, 'Research vault');
  const fromFolder = await snapshot(page);
  const folderPaths = Object.keys(fromFolder.notes).sort();
  check('folder import: a new library named after the folder', fromFolder.name === 'Research vault');
  check(
    'folder import: every note, nested folders and a Chinese name kept, the top folder stripped',
    JSON.stringify(folderPaths) === JSON.stringify(KEPT.filter((p) => p.endsWith('.md')).sort()),
    folderPaths.join(', '),
  );
  check('folder import: .obsidian, .DS_Store and hidden files are skipped', !folderPaths.some((p) => p.includes('.obsidian') || p.includes('.hidden')));
  check('folder import: a BOM at the start of a file is dropped', !fromFolder.notes['Inbox/bom.md']?.startsWith('\ufeff'));
  check('folder import: [[links]] resolve across folders (aliases, headings, Chinese)', fromFolder.links >= 5, `${fromFolder.links} links`);
  const hasImage = await page.evaluate(async () => !!(await window.netnote.library.attachmentUrl('diagram.png')));
  check('folder import: an image attachment is stored', hasImage);

  // 3. round trip: export the imported folder, the files come back byte for byte
  const ex2 = await exportZip(page, TMP, 'folder');
  const back = Object.keys(ex2.entries).sort();
  check('round trip: the same files come back (no more, no fewer)', JSON.stringify(back) === JSON.stringify([...KEPT].sort()), back.join(', '));
  const same = KEPT.every((p) => {
    const orig = files[p];
    const got = ex2.entries[p];
    if (!got) return false;
    return Buffer.isBuffer(orig) ? Buffer.compare(Buffer.from(got), orig) === 0 : strFromU8(got) === stripBom(orig);
  });
  check('round trip: every note and the image are unchanged', same);

  // 4. import that zip again (a zip with a top folder, as Finder or Explorer makes it)
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([p, c]) => [`Research vault/${p}`, Buffer.isBuffer(c) ? new Uint8Array(c) : strToU8(c)])),
  );
  const zipFile = path.join(TMP, 'Research vault.zip');
  fs.writeFileSync(zipFile, zipped);
  await openDrawer(page);
  const before = await page.evaluate(async () => (await window.netnote.library.list()).length);
  await page.setInputFiles('input[type=file][accept*=".zip"]', zipFile);
  await page.waitForFunction((n) => window.netnote.library.list().then((l) => l.length === n + 1), before, { timeout: 20000 });
  await page.waitForTimeout(500);
  const fromZip = await snapshot(page);
  check('zip import: opens as its own library, named after the zip', fromZip.name === 'Research vault');
  check(
    'zip import: the same notes and links as the folder import',
    JSON.stringify(Object.keys(fromZip.notes).sort()) === JSON.stringify(folderPaths) && fromZip.links === fromFolder.links,
  );
  check('zip import: the content matches the files on disk', fromZip.notes['Topics/深/睡眠与记忆.md'] === files['Topics/深/睡眠与记忆.md']);

  // 5. loose Markdown files
  await openDrawer(page);
  await page.setInputFiles('input[type=file][accept*=".zip"]', [path.join(SRC, 'Index.md'), path.join(SRC, 'Topics/Memory.md')]);
  await page.waitForFunction(() => Object.keys(Object.fromEntries(window.netnote.library.vault.notes)).length === 2, null, { timeout: 20000 });
  const loose = await snapshot(page);
  check(
    'loose files import: two .md files become a two-note library',
    Object.keys(loose.notes).sort().join() === 'Index.md,Memory.md' && loose.name === 'Index',
    Object.keys(loose.notes).join(', '),
  );

  // 6. nothing to import: a zip with no notes is refused, the open library stays
  const empty = path.join(TMP, 'nothing.zip');
  fs.writeFileSync(empty, zipSync({ 'readme.txt.bak': strToU8('x') }));
  const countBefore = await page.evaluate(async () => (await window.netnote.library.list()).length);
  await openDrawer(page);
  await page.setInputFiles('input[type=file][accept*=".zip"]', empty);
  await page.waitForTimeout(1500);
  const countAfter = await page.evaluate(async () => (await window.netnote.library.list()).length);
  check('a zip with no notes adds no library', countAfter === countBefore);

  // 7. everything survives closing the browser tab: reopen and switch back
  await page.close();
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push(e.message));
  await ready(page2);
  const libs = await page2.evaluate(async () => (await window.netnote.library.list()).map((l) => l.name));
  check(
    'after reopening, every library is still there',
    libs.filter((n) => n === 'Research vault').length === 2 && libs.length === countAfter,
    libs.join(' | '),
  );
  const sampleId = await page2.evaluate(async () => (await window.netnote.library.list()).find((l) => l.origin !== 'import')?.id);
  await page2.evaluate((id) => window.netnote.library.open(id), sampleId);
  await page2.waitForTimeout(600);
  const kept = await page2.evaluate(() => window.netnote.library.vault.notes.get('Walking.md')?.raw ?? '');
  check('after reopening, the edit in the sample library is kept', kept.includes('ünïcødé ✓ 中文'));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
} catch (e) {
  check('transfer run finished', false, e instanceof Error ? e.stack : String(e));
} finally {
  await browser.close();
  await server?.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(results.join('\n'));
console.log(failed ? '\nSome checks failed.' : `\nAll ${results.length} transfer checks passed.`);
process.exit(failed ? 1 : 0);
