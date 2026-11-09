/**
 * End-to-end tests in the IWSDK emulator (IWER, emulating a Meta Quest 3).
 *
 *   npm run test:e2e            (starts its own dev server on port 8091)
 *   E2E_URL=https://localhost:8081/ npm run test:e2e   (uses the one already running)
 *
 * Drives the real app in Chromium: the desktop preview, then an immersive session with emulated
 * hands (pinch to read, pinch-and-drag one star onto another to connect, type the reason), and checks
 * that what was written survives a reload. Exit code 1 on any failure.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';

const PORT = 8091;
/** Set E2E_URL to test a dev server that is already running (one dev runtime per workspace). */
const URL_ = process.env.E2E_URL || `https://localhost:${PORT}/`;
const results = [];
let failed = false;

function check(name, ok, detail = '') {
  results.push(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
}

async function launch() {
  const args = ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ args, executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  }
}

async function ready(page) {
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.netnote?.library.vault, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/** Point the right hand from just in front of the chest straight at a star. */
function aim(page, id) {
  return page.evaluate((id) => {
    const { app } = window.netnote;
    const hand = window.IWER_DEVICE.hands.right;
    const target = app.graph.worldPos(id);
    const V = target.constructor;
    const Q = app.graph.root.quaternion.constructor;
    const from = new V(0.15, 1.35, -0.25);
    hand.position.set(from.x, from.y, from.z);
    const q = new Q().setFromUnitVectors(new V(0, 0, -1), target.clone().sub(from).normalize());
    hand.quaternion.set(q.x, q.y, q.z, q.w);
  }, id);
}

const pinch = (page, v) => page.evaluate((v) => window.IWER_DEVICE.hands.right.updatePinchValue(v), v);
const state = (page) => page.evaluate(() => window.netnote.app.state);

async function desktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  check(
    'the 2D workspace is shown, the library drawer tucked away',
    (await page.isVisible('[data-testid=workspace]')) && !(await page.isVisible('[data-testid=landing] [data-testid=import-zip]')),
  );
  const n = await page.evaluate(() => window.netnote.library.vault.notes.size);
  check('sample library is seeded on first run', n >= 30, `${n} notes`);
  await page.click('[data-testid=ws-library]');
  await page.waitForTimeout(400);
  check('"Library" opens the drawer (import, export, switch)', await page.isVisible('[data-testid=import-zip]'));
  await page.click('[data-testid=close-library]');

  // write in a real text field: put the cursor in the middle and type there
  await page.click('[data-path="Walking.md"]');
  await page.waitForTimeout(200);
  check('a note opens in the middle', (await page.inputValue('[data-testid=ws-title]')) === 'Walking');
  const raw0 = await page.inputValue('[data-testid=ws-text]');
  const at = raw0.indexOf('\n', raw0.indexOf('# Walking')) + 1;
  await page.evaluate((at) => {
    const t = document.querySelector('[data-testid=ws-text]');
    t.focus();
    t.setSelectionRange(at, at);
  }, at);
  await page.keyboard.type('Typed from the desk. ');
  await page.waitForTimeout(1500);
  const saved = await page.evaluate(() => window.netnote.library.vault.notes.get('Walking.md').raw);
  check('typing anywhere in the note saves by itself', saved.slice(at, at + 21) === 'Typed from the desk. ', saved.slice(at - 5, at + 25));

  // [[ offers notes to link, Enter takes the highlighted one
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nSee [[Slee');
  await page.waitForTimeout(250);
  const chips = await page.$$eval('[data-testid=ws-link-pop] .nn-chip', (b) => b.map((x) => x.textContent));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  const linked = await page.evaluate(() => window.netnote.library.vault.notes.get('Walking.md').raw);
  check('typing [[ offers notes to link; Enter completes the link; Ctrl+S saves', chips.length > 0 && linked.includes(`See [[${chips[0]}]]`), chips.join(', '));

  // reading view: links are live
  await page.click('[data-testid=ws-read]');
  await page.waitForTimeout(200);
  await page.click(`.nn-read [data-link="${chips[0]}"]`);
  await page.waitForTimeout(300);
  check('in the reading view a link opens its note', (await page.inputValue('[data-testid=ws-title]')) === chips[0]);
  const side = await page.$$eval('[data-testid=ws-in] .nn-go b', (b) => b.map((x) => x.textContent));
  check('its connections show who links to it', side.includes('Walking'), side.slice(0, 5).join(', '));

  // a new note, renamed through its title, then deleted with an in-page confirmation
  await page.click('[data-testid=ws-new]');
  await page.waitForTimeout(300);
  await page.keyboard.type('Desk thoughts');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const named = await page.evaluate(() => [...window.netnote.library.vault.notes.values()].some((x) => x.name === 'Desk thoughts'));
  check('"New note" puts you in its title; Enter renames it', named);
  await page.click('[data-testid=ws-delete]');
  await page.click('[data-testid=ws-confirm-delete]');
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => ![...window.netnote.library.vault.notes.values()].some((x) => x.name === 'Desk thoughts'));
  check('delete asks in the page, then deletes', gone);

  // a change made elsewhere (in the headset) shows up while you are not typing
  await page.click('[data-path="Walking.md"]');
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    const lib = window.netnote.library;
    await lib.saveNote('Walking.md', lib.vault.notes.get('Walking.md').raw + '\nAdded in the headset.\n');
  });
  await page.waitForTimeout(300);
  check('edits made in the headset appear here', (await page.inputValue('[data-testid=ws-text]')).includes('Added in the headset.'));

  // the star map here is a flat 2D map (the 3D one is for the headset)
  await page.click('[data-testid=ws-graph]');
  await page.waitForSelector('[data-testid=graph2d] canvas', { state: 'visible' });
  await page.waitForTimeout(300);
  const g2 = await page.evaluate(() => {
    const g = window.netnote.workspace.graph;
    const r = g.root.getBoundingClientRect();
    const p = g.screenOf('Memory.md');
    return { w: r.width, h: r.height, x: r.left + p.x, y: r.top + p.y, inside: p.x > 0 && p.y > 0 && p.x < r.width && p.y < r.height };
  });
  check('"Graph" shows a flat 2D star map filling the page', g2.w > 700 && g2.h > 500 && g2.inside, JSON.stringify(g2));
  await page.mouse.click(g2.x, g2.y);
  await page.waitForTimeout(200);
  const card = await page.textContent('.nn-g2-card');
  check('clicking a star shows its card', (card ?? '').includes('Memory'), card ?? '');
  // zoom with the wheel, around the pointer
  const k0 = await page.evaluate(() => window.netnote.workspace.graph.view.k);
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(200);
  const k1 = await page.evaluate(() => window.netnote.workspace.graph.view.k);
  check('the scroll wheel zooms the 2D map', k1 > k0 * 1.2, `${k0.toFixed(2)} → ${k1.toFixed(2)}`);
  await page.click('[data-testid=g2-open]');
  await page.waitForTimeout(300);
  check('"Open" goes back to the note', (await page.inputValue('[data-testid=ws-title]')) === 'Memory' && !(await page.isVisible('[data-testid=graph2d]')));
  check('no page errors (desktop)', errors.length === 0, errors[0]);
  await page.close();
}

async function immersive(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.click('[data-testid=enter-vr]');
  await page.waitForFunction(() => window.netnote.world.visibilityState.value !== 'non-immersive', null, { timeout: 20000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.controlMode = 'programmatic';
    window.IWER_DEVICE.primaryInputMode = 'hand';
  });
  await page.waitForTimeout(600);
  const hint = await page.evaluate(() => window.netnote.app.hint.text);
  check('first-run tour starts in the headset', hint.length > 0, hint);

  await aim(page, 'Memory.md');
  await page.waitForTimeout(300);
  await pinch(page, 1);
  await page.waitForTimeout(300);
  await pinch(page, 0);
  await page.waitForTimeout(700);
  check('pinching a star opens its card (hands)', (await state(page)).cards[0] === 'Memory.md');
  await page.waitForFunction(() => !window.netnote.app.turn, null, { timeout: 5000 }); // the graph has turned it to you

  const pair = await page.evaluate(() => {
    const { app } = window.netnote;
    const ids = app.graph.nodes
      .filter((n) => !n.ghost && !n.file)
      .map((n) => n.id)
      .sort((a, b) => app.graph.worldPos(b).y - app.graph.worldPos(a).y)
      .slice(0, 8)
      .filter((id) => app.graph.worldPos(id).x < 0.2);
    for (const a of ids) for (const b of ids) if (a !== b && !app.graph.neighboursOf(a).has(b)) return [a, b];
    return null;
  });
  check('found two unlinked stars to connect', !!pair, String(pair));
  if (!pair) return;
  await aim(page, pair[0]);
  await page.waitForTimeout(300);
  await pinch(page, 1);
  await page.waitForTimeout(300);
  for (let i = 0; i < 4; i++) {
    await aim(page, pair[1]);
    await page.waitForTimeout(150);
  }
  await pinch(page, 0);
  await page.waitForTimeout(700);
  check('dragging a star onto another asks why they connect', (await state(page)).composer);

  await page.evaluate(() => window.netnote.app.onComposer('type'));
  await page.waitForTimeout(200);
  await page.keyboard.type('both are about retrieval');
  await page.evaluate(() => window.netnote.app.onComposer('save'));
  await page.waitForTimeout(800);
  const raw = await page.evaluate((a) => window.netnote.library.vault.notes.get(a).raw, pair[0]);
  const name = pair[1].replace(/\.md$/, '');
  check('the link and its reason are written into the note', raw.includes(`[[${name}]] — both are about retrieval`));

  // the headset keyboard writes its own buffer into the text field (replacing it): typing in the
  // middle of a paragraph must insert there, not wipe the paragraph
  const mid = await page.evaluate(async () => {
    const a = window.netnote.app;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    a.select('Walking.md');
    await wait(300);
    const c = a.cards[0];
    c.repaint();
    const r = c.regionCenter('edit');
    c.clickAt(r.x, r.y);
    const e = a.editor;
    e.repaint();
    const b = e.regionCenter('block', '1');
    e.clickAt(b.x, b.y);
    a.input.setText('Walking clears the head.');
    a.input.setCaret('Walking'.length);
    a.input.showKeyboard();
    const f = a.input.field;
    const out = [];
    for (const v of [' X', ' XY', ' XYZ', ' XY']) {
      f.value = v;
      f.setSelectionRange(v.length, v.length);
      f.dispatchEvent(new window.Event('input', { bubbles: true }));
      out.push(a.input.text);
    }
    const caret = a.input.caret;
    a.closeEditor?.();
    return { out, caret };
  });
  check(
    'typing in the middle of a paragraph in the headset inserts there (backspace too), never clearing it',
    mid.out.join('|') === 'Walking X clears the head.|Walking XY clears the head.|Walking XYZ clears the head.|Walking XY clears the head.' &&
      mid.caret === 'Walking XY'.length,
    JSON.stringify(mid),
  );
  await ready(page);
  const after = await page.evaluate((a) => window.netnote.library.vault.notes.get(a).raw, pair[0]);
  check('the new link survives a reload (IndexedDB)', after.includes(`[[${name}]]`));
  check('no page errors (immersive)', errors.length === 0, errors[0]);
  await ctx.close();
}

async function wall(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  const s = await page.evaluate(async () => {
    const { app } = window.netnote;
    app.select('Sleep.md');
    app.onCard(app.cards[0], 'wall');
    app.select('Memory replay.md');
    const card = app.cards.find((c) => c.path === 'Memory replay.md');
    const first = [...app.onWall.values()][0];
    app.putOnWall(card, { az: first.az - 17, h: first.h }); // edge to edge with the first card
    await new Promise((r) => setTimeout(r, 300));
    return app.state;
  });
  check('cards hang on the thinking wall', s.wall.length === 2, JSON.stringify(s.wall));
  check('cards placed side by side form a group', s.groups.length === 1 && s.groups[0].length === 2);
  const tag = await page.evaluate(() => {
    const t = window.netnote.app.tags[0];
    t.repaint();
    return { q: t.question, add: t.regionCenter('add'), answer: t.regionCenter('answer') };
  });
  check('the group asks a question', tag.q.length > 20, tag.q.slice(0, 60));
  check('the group suggests a missing note', !!tag.add);
  await page.evaluate((p) => window.netnote.app.tags[0].clickAt(p.x, p.y), tag.add);
  await page.waitForTimeout(400);
  const n = (await state(page)).wall.length;
  check('pinching the suggestion brings it into the group', n === 3, `${n} on the wall`);
  await page.evaluate(() => {
    const t = window.netnote.app.tags[0];
    t.repaint();
    const a = t.regionCenter('answer');
    t.clickAt(a.x, a.y);
  });
  await page.waitForTimeout(300);
  check('"write an answer" opens the writing card', (await state(page)).composer);
  await page.keyboard.type('Sleep replays the day');
  await page.evaluate(() => window.netnote.app.onComposer('save'));
  await page.waitForTimeout(900);
  const answer = await page.evaluate(() => {
    const v = window.netnote.library.vault;
    const n = v.notes.get('Inbox/Sleep replays the day.md');
    return { raw: n?.raw ?? '', wall: window.netnote.app.state.wall };
  });
  check(
    'the answer is a new note linked to every card of the group',
    answer.raw.includes('[[Sleep]]') && answer.raw.includes('[[Memory replay]]'),
    answer.raw.slice(-90),
  );
  check('the answer joins the group on the wall', answer.wall.includes('Inbox/Sleep replays the day.md'));
  await page.waitForTimeout(600); // the wall is saved shortly after a change
  await ready(page);
  const after = await page.evaluate(() => window.netnote.app.state.wall.length);
  check('the wall comes back after a reload', after === 4, `${after} cards`);
  check('no page errors (wall)', errors.length === 0, errors[0]);
  await ctx.close();
}

async function insights(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => window.netnote.app.onDock('topics'));
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const p = window.netnote.app.insightsPanel;
    p.repaint();
    return { open: window.netnote.app.state.insights, counts: p.counts, first: p.rows[0]?.key };
  });
  check('the insights panel opens from the menu', info.open);
  check(
    'it finds hidden links, questions, unwritten and drifting notes',
    ['links', 'questions', 'wanted', 'drifting'].every((k) => info.counts[k] > 0),
    JSON.stringify(info.counts),
  );
  const before = info.counts.links;
  await page.evaluate((k) => {
    const p = window.netnote.app.insightsPanel;
    const c = p.regionCenter('dismiss', k);
    p.clickAt(c.x, c.y);
    p.repaint();
  }, info.first);
  const after = await page.evaluate(() => window.netnote.app.insightsPanel.counts.links);
  check('"not related" hides a suggestion', after === before - 1, `${before} → ${after}`);
  const linkedKey = await page.evaluate(() => {
    const p = window.netnote.app.insightsPanel;
    const k = p.rows[0].key;
    const c = p.regionCenter('link', k);
    p.clickAt(c.x, c.y);
    return k;
  });
  await page.waitForTimeout(300);
  check('"connect" on a hidden link asks why', (await state(page)).composer);
  await page.evaluate(() => window.netnote.app.onComposer('cancel')); // skip the reason: link without one
  await page.waitForTimeout(600);
  const still = await page.evaluate((k) => window.netnote.app.insightsPanel.rows.some((r) => r.key === k), linkedKey);
  check('a connected suggestion leaves the list', !still);
  // the map in your hand: pick a note and the big graph turns it round to face you
  await page.evaluate(() => window.netnote.app.onDock('map'));
  await page.waitForTimeout(600);
  const facing = (id) =>
    page.evaluate((id) => {
      const { app } = window.netnote;
      app.graph.root.updateMatrixWorld();
      const c = app.graph.centre().applyMatrix4(app.graph.root.matrixWorld);
      const p = app.graph.worldPos(id);
      const e = app.world.camera.getWorldPosition(p.clone());
      const a = Math.atan2(p.x - c.x, p.z - c.z) - Math.atan2(e.x - c.x, e.z - c.z);
      return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) * (180 / Math.PI);
    }, id);
  // pick the note that is furthest round the back right now
  const far = await page.evaluate(() => {
    const { app } = window.netnote;
    app.graph.root.updateMatrixWorld();
    const c = app.graph.centre().applyMatrix4(app.graph.root.matrixWorld);
    const e = app.world.camera.getWorldPosition(c.clone());
    let best = null;
    let bestA = 0;
    for (const n of app.graph.nodes) {
      if (!app.library.vault.notes.has(n.id)) continue;
      const p = app.graph.worldPos(n.id);
      const a = Math.abs(
        Math.atan2(
          Math.sin(Math.atan2(p.x - c.x, p.z - c.z) - Math.atan2(e.x - c.x, e.z - c.z)),
          Math.cos(Math.atan2(p.x - c.x, p.z - c.z) - Math.atan2(e.x - c.x, e.z - c.z)),
        ),
      );
      if (Math.hypot(p.x - c.x, p.z - c.z) > 0.2 && a > bestA) {
        bestA = a;
        best = n.id;
      }
    }
    return best;
  });
  const yaw0 = await facing(far);
  const visible = await page.evaluate((id) => {
    const { app } = window.netnote;
    app.minimap.onPick(id);
    return app.state.minimap;
  }, far);
  await page.waitForTimeout(2600);
  const yaw1 = await facing(far);
  check('the map in your hand shows', visible);
  check('picking a note on the map turns the graph so it faces you', yaw1 < 15 && yaw0 > 60, `${yaw0.toFixed(0)}° → ${yaw1.toFixed(0)}°`);
  const follows = await page.evaluate(async () => {
    const { app } = window.netnote;
    const Q = app.graph.root.quaternion.constructor;
    const V = app.graph.root.position.constructor;
    app.graph.root.quaternion.multiply(new Q().setFromAxisAngle(new V(1, 0, 0), 0.5));
    await new Promise((r) => setTimeout(r, 200));
    return { map: app.minimap.group.quaternion.angleTo(app.graph.root.quaternion), noRing: !app.minimap.group.getObjectByName('minimap-bezel') };
  });
  check('the map always shows the big graph the way it is turned', follows.map < 0.01 && follows.noRing, JSON.stringify(follows));
  check('no page errors (insights)', errors.length === 0, errors[0]);
  await ctx.close();
}

async function editing(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  const press = (id) =>
    page.evaluate((id) => {
      const c = window.netnote.app.cards[0];
      c.repaint();
      const r = c.regionCenter(id);
      c.clickAt(r.x, r.y);
    }, id);
  await page.evaluate(() => window.netnote.app.select('Habit loop.md'));
  await press('rename');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.netnote.app.input.clear());
  await page.keyboard.type('Cue routine reward');
  await page.evaluate(() => window.netnote.app.onComposer('save'));
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const v = window.netnote.library.vault;
    return {
      renamed: v.notes.has('Cue routine reward.md'),
      old: v.notes.has('Habit loop.md'),
      habits: v.notes.get('Habits.md').raw,
      card: window.netnote.app.cards[0].path,
    };
  });
  check('renaming a note in the headset updates every link to it', r.renamed && !r.old && r.habits.includes('[[Cue routine reward]]'));
  check('the open card follows the renamed note', r.card === 'Cue routine reward.md', r.card);
  await press('delete');
  const asked = await page.evaluate(() => window.netnote.library.vault.notes.has('Cue routine reward.md'));
  await press('delete');
  await page.waitForTimeout(500);
  const gone = await page.evaluate(() => !window.netnote.library.vault.notes.has('Cue routine reward.md') && window.netnote.app.state.cards.length === 0);
  check('delete asks once, then deletes and closes the card', asked && gone);
  check('no page errors (editing)', errors.length === 0, errors[0]);
  await ctx.close();
}

/** Mixed reality with a synthetic room: a desk in front of you and a wall on your left. */
async function mixedReality(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.text().includes('frame error') && errors.push(m.text()));
  await ready(page);
  await page.evaluate(() => {
    const pt = (x, z) => new DOMPointReadOnly(x, 0, z, 1);
    const rect = (w, h) => [pt(-w / 2, -h / 2), pt(w / 2, -h / 2), pt(w / 2, h / 2), pt(-w / 2, h / 2)];
    const s = Math.SQRT1_2;
    const planes = new Set([
      { transform: new XRRigidTransform({ x: 0, y: 0.85, z: -0.75 }, { x: 0, y: 0, z: 0, w: 1 }), polygon: rect(1.2, 0.7), semanticLabel: 'table' },
      { transform: new XRRigidTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }), polygon: rect(5, 5), semanticLabel: 'floor' },
      { transform: new XRRigidTransform({ x: -1.5, y: 1.3, z: 0.3 }, { x: 0, y: 0, z: -s, w: s }), polygon: rect(2.4, 3.5), semanticLabel: 'wall' },
    ]);
    // the smallest synthetic environment IWER accepts: only planes, nothing drawn
    class RoomWithDesk {
      constructor() {
        this.version = 'test';
        this.planesVisible = this.boundingBoxesVisible = this.meshesVisible = false;
        this.canvas = document.createElement('canvas');
      }
      render() {}
      loadEnvironment() {}
      async loadDefaultEnvironment() {}
      get environmentCanvas() {
        return this.canvas;
      }
      get trackedPlanes() {
        return planes;
      }
      get trackedMeshes() {
        return new Set();
      }
      deleteAll() {}
      computeHitTestResults() {
        return [];
      }
      computeDepthBuffer() {
        return null;
      }
    }
    window.IWER_DEVICE.installSEM(RoomWithDesk);
  });
  await page.click('[data-testid=enter-ar]');
  await page.waitForFunction(() => window.netnote.app.room.table && window.netnote.app.room.wall, null, { timeout: 15000 }).catch(() => undefined);
  const r = await page.evaluate(() => {
    const { app, world } = window.netnote;
    const b = app.graph.root.position;
    return {
      blend: world.session?.environmentBlendMode,
      table: app.room.table,
      wall: app.room.wall,
      sky: app.env.group.visible,
      y: b.y,
      radius: app.wallGeo.radius,
    };
  });
  check('mixed reality shows your room (passthrough, no sky)', r.blend === 'alpha-blend' && !r.sky, r.blend);
  check(
    'scene understanding finds the desk and puts the graph on it',
    !!r.table && r.table.label === 'table' && r.y > 0.85 && r.y < 1.4,
    r.table ? `graph at ${r.y.toFixed(2)} m` : 'no table',
  );
  check(
    'the thinking wall is fitted to the real wall on the left',
    !!r.wall && Math.abs(r.radius - 1.42) < 0.05,
    r.wall ? `ring ${r.radius.toFixed(2)} m` : 'no wall',
  );

  // tap a star, then tap the card's × with the hand ray, several times: the loop must keep running
  await page.evaluate(() => {
    window.IWER_DEVICE.controlMode = 'programmatic';
    window.IWER_DEVICE.primaryInputMode = 'hand';
    const app = window.netnote.app;
    window.__frames = 0;
    const u = app.update.bind(app);
    app.update = (dt) => {
      window.__frames++;
      u(dt);
    };
  });
  const ids = await page.evaluate(() =>
    window.netnote.app.graph.nodes
      .filter((n) => !n.ghost && !n.file)
      .map((n) => n.id)
      .slice(0, 5),
  );
  let closed = 0;
  let stalled = false;
  for (const id of ids) {
    await page.evaluate((id) => window.netnote.app.select(id), id);
    await page.waitForFunction(() => !window.netnote.app.turn, null, { timeout: 5000 }).catch(() => undefined);
    await page.evaluate(() => {
      const { app } = window.netnote;
      const c = app.cards[0];
      c.repaint();
      const r = c.regionCenter('close');
      const V = c.mesh.position.constructor;
      const Q = c.mesh.quaternion.constructor;
      const target = c.mesh.localToWorld(new V((r.x / c.pxW - 0.5) * c.widthM, (0.5 - r.y / c.pxH) * c.heightM, 0.002));
      const hand = window.IWER_DEVICE.hands.right;
      const from = new V(0.15, 1.35, -0.25);
      hand.position.set(from.x, from.y, from.z);
      const q = new Q().setFromUnitVectors(new V(0, 0, -1), target.clone().sub(from).normalize());
      hand.quaternion.set(q.x, q.y, q.z, q.w);
    });
    await page.waitForTimeout(200);
    const f0 = await page.evaluate(() => window.__frames);
    await pinch(page, 1);
    await page.waitForTimeout(250);
    await pinch(page, 0);
    await page.waitForTimeout(600);
    const f1 = await page.evaluate(() => window.__frames);
    if (f1 - f0 < 3) {
      stalled = true;
      break;
    }
    if ((await state(page)).cards.length === 0) closed++;
  }
  check(
    'tapping × on a card closes it, again and again, without freezing (mixed reality)',
    closed === ids.length && !stalled,
    `${closed}/${ids.length} closed${stalled ? ', render loop stopped' : ''}`,
  );
  check('no page errors (mixed reality)', errors.length === 0, errors[0]);
  await ctx.close();
}

/** Hands only: press the menu with a fingertip, turn the left palm up for the map, zoom with its rail. */
async function handsDirect(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await page.click('[data-testid=enter-vr]');
  await page.waitForFunction(() => window.netnote.world.visibilityState.value !== 'non-immersive', null, { timeout: 20000 });
  await page.evaluate(() => {
    window.IWER_DEVICE.controlMode = 'programmatic';
    window.IWER_DEVICE.primaryInputMode = 'hand';
  });
  await page.waitForTimeout(1200);
  // push the right index fingertip through a button on the menu and back out
  const poke = (id, quietFirst = false) =>
    page.evaluate(
      async ([id, quietFirst]) => {
        const { app, world } = window.netnote;
        const d = app.dock;
        const V = d.mesh.position.constructor;
        const Q = d.mesh.quaternion.constructor;
        d.repaint();
        const r = d.regionCenter(id);
        const btn = d.mesh.localToWorld(new V((r.x / d.pxW - 0.5) * d.widthM, (0.5 - r.y / d.pxH) * d.heightM, 0));
        const n = new V(0, 0, 1).applyQuaternion(d.mesh.getWorldQuaternion(new Q()));
        const hand = window.IWER_DEVICE.hands.right;
        const tip = world.player.indexTipSpaces.right;
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const tipNow = () => {
          tip.updateMatrixWorld();
          return new V().setFromMatrixPosition(tip.matrixWorld);
        };
        let acted = null;
        const was = d.onAction;
        d.onAction = (a, ...rest) => {
          acted = a;
          was?.(a, ...rest);
        };
        if (quietFirst) {
          app.input.begin('', () => undefined);
          app.input.onTyped?.();
        }
        const dist = btn.distanceTo(world.camera.getWorldPosition(new V()));
        for (const k of [0.06, 0.02, 0.005, -0.008, 0.06]) {
          if (quietFirst) app.input.onTyped?.(); // still typing
          const want = btn.clone().addScaledVector(n, k);
          for (let i = 0; i < 3; i++) {
            const off = want.clone().sub(tipNow());
            hand.position.set(hand.position.x + off.x, hand.position.y + off.y, hand.position.z + off.z);
            await wait(110);
          }
        }
        d.onAction = was;
        if (quietFirst) app.input.end();
        return { acted, dist };
      },
      [id, quietFirst],
    );
  const typed = await poke('search', true);
  check('while you type, a resting fingertip presses nothing', typed.acted === null, String(typed.acted));
  await page.waitForTimeout(600);
  const pressed = await poke('search');
  check('a fingertip press on the menu works (no ray needed)', pressed.acted === 'search', String(pressed.acted));
  const onlyMenu = await page.evaluate(() => window.netnote.app.pokeable.map((o) => o.name).sort());
  check('only the menu bar answers a fingertip; other panels take the ray', onlyMenu.join() === 'dock,tools', onlyMenu.join());
  check('with hands, the menu sits within reach of a fingertip', pressed.dist < 0.56, `${pressed.dist.toFixed(2)} m`);
  await page.evaluate(() => window.netnote.app.closeSearch?.());
  await page.waitForTimeout(300);

  // the left hand held out in front, palm down, then turned palm up towards you
  const palm = (up) =>
    page.evaluate((up) => {
      const left = window.IWER_DEVICE.hands.left;
      left.position.set(-0.12, 1.25, -0.35);
      const s = Math.SQRT1_2;
      // palm up: rolled half a turn about the forearm (z), then tipped a little towards the eyes
      if (up) left.quaternion.set(0, 0, 1, 0);
      else left.quaternion.set(0, 0, 0, 1);
      void s;
    }, up);
  // the right hand held out to the right, relaxed
  await page.evaluate(() => {
    const right = window.IWER_DEVICE.hands.right;
    right.position.set(0.16, 1.2, -0.35);
    right.quaternion.set(0, 0, 0, 1);
  });
  await palm(false);
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.netnote.app.minimap.visible);
  await palm(true);
  await page.waitForTimeout(1000);
  const shown = await page.evaluate(() => {
    const { app } = window.netnote;
    const m = app.minimap.group.position;
    const h = window.IWER_DEVICE.hands.left.position;
    const r = window.IWER_DEVICE.hands.right.position;
    return { visible: app.minimap.visible, x: m.x, lx: h.x, rx: r.x, ahead: Math.abs(m.z - (h.z + r.z) / 2) };
  });
  check(
    'turning the left palm up brings the map up between the hands',
    !before && shown.visible && shown.x > Math.min(shown.lx, shown.rx) && shown.x < Math.max(shown.lx, shown.rx) && shown.ahead < 0.2,
    JSON.stringify(shown),
  );
  // once up, it stays where it appeared (it does not chase the hand)
  const still = await page.evaluate(async () => {
    const { app } = window.netnote;
    const a = app.minimap.group.position.clone();
    const left = window.IWER_DEVICE.hands.left;
    left.position.set(left.position.x - 0.06, left.position.y, left.position.z);
    await new Promise((res) => setTimeout(res, 400));
    left.position.set(left.position.x + 0.06, left.position.y, left.position.z);
    return app.minimap.group.position.distanceTo(a);
  });
  check('the map stays fixed where it appeared', still < 0.01, `${still.toFixed(3)} m`);
  // hold the map in both hands: pinch at its left and right edges, then pull apart and turn
  const hold = await page.evaluate(async () => {
    const { app } = window.netnote;
    const m = app.minimap.group.position.clone();
    const V = m.constructor;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const hands = window.IWER_DEVICE.hands;
    // move a hand so its pinch point (between thumb and index tips) lands on a target
    const put = async (h, target) => {
      for (let i = 0; i < 4; i++) {
        await wait(90);
        const off = target.clone().sub(app.pinches[h].at);
        const p = hands[h].position;
        hands[h].position.set(p.x + off.x, p.y + off.y, p.z + off.z);
      }
    };
    const s0 = app.graph.root.scale.x;
    const q0 = app.graph.root.quaternion.clone();
    // where the pinch point sits relative to each hand once the fingers are closed
    hands.left.updatePinchValue(1);
    hands.right.updatePinchValue(1);
    await wait(300);
    const offs = {};
    for (const h of ['left', 'right']) {
      const p = hands[h].position;
      offs[h] = app.pinches[h].at.clone().sub(new V(p.x, p.y, p.z));
    }
    hands.left.updatePinchValue(0);
    hands.right.updatePinchValue(0);
    await wait(200);
    // bring the open hands to the ball's left and right edges, then close both pinches there
    for (const [h, dx] of [
      ['left', -0.05],
      ['right', 0.05],
    ]) {
      const at = m
        .clone()
        .add(new V(dx, 0, 0))
        .sub(offs[h]);
      hands[h].position.set(at.x, at.y, at.z);
    }
    await wait(200);
    hands.left.updatePinchValue(1);
    hands.right.updatePinchValue(1);
    await wait(400);
    const held = app.minimap.held;
    // pull apart to twice the distance, and raise the right hand (a turn)
    for (let i = 1; i <= 5; i++) {
      await put('right', m.clone().add(new V(0.05 + i * 0.012, i * 0.012, 0)));
      await put('left', m.clone().add(new V(-0.05 - i * 0.008, 0, 0)));
    }
    const s1 = app.graph.root.scale.x;
    const turned = app.graph.root.quaternion.angleTo(q0);
    // still pinching: turning the palm away does not put the map away
    hands.left.quaternion.set(0, 0, 0, 1);
    await wait(700);
    const keptWhileHeld = app.minimap.visible && app.minimap.held;
    hands.left.updatePinchValue(0);
    hands.right.updatePinchValue(0);
    // it fades out within a second or so (frames are slow in the emulator: poll)
    for (let i = 0; i < 20 && app.minimap.visible; i++) await wait(150);
    return { held, s0, s1, turned, keptWhileHeld, after: app.minimap.held, goneAfter: !app.minimap.visible };
  });
  check(
    'pinching the map with both hands takes hold of it; pulling apart zooms and turning turns the big graph',
    hold.held && hold.s1 > hold.s0 * 1.4 && hold.turned > 0.15 && !hold.after,
    `zoom ×${(hold.s1 / hold.s0).toFixed(2)}, turned ${((hold.turned * 180) / Math.PI).toFixed(0)}°`,
  );
  check('while both hands still pinch, the map stays even with the palm turned away', hold.keptWhileHeld);
  check('letting go with the palm turned away puts the map away', hold.goneAfter, JSON.stringify(hold));
  await palm(true);
  await page.waitForTimeout(1000);
  check('palm up again brings it back', await page.evaluate(() => window.netnote.app.minimap.visible));
  await palm(false);
  await page.waitForTimeout(2200);
  check('turning the palm back puts the map away', !(await page.evaluate(() => window.netnote.app.minimap.visible)));
  check('no page errors (hands)', errors.length === 0, errors[0]);
  await ctx.close();
}

async function explore(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  await ready(page);
  const app = (fn, arg) => page.evaluate(fn, arg);
  await app(() => window.netnote.app.select('Memory.md'));
  await page.waitForTimeout(60);
  const early = await app(() => window.netnote.app.cards[0].mesh.scale.x);
  await page.waitForTimeout(600);
  const m = await app(() => {
    const a = window.netnote.app;
    const c = a.cards[0];
    return { scale: c.mesh.scale.x, opacity: c.mesh.material.opacity, flows: a.state.flows, tethers: a.state.tethers };
  });
  check('a new card grows in, then rests at full size', early < 1 && m.scale === 1 && m.opacity === 1, `${early.toFixed(2)} → ${m.scale}`);
  check('data flows along the links of the note you read', m.flows > 0, `${m.flows} particles`);
  check('a thread ties the card to its star', m.tethers >= 1);

  // path finder: from Memory.md to a note three links away
  const far = await app(() => {
    const g = window.netnote.app.graph;
    const v = window.netnote.library.vault;
    const dist = new Map([['Memory.md', 0]]);
    let q = ['Memory.md'];
    while (q.length) {
      const n = [];
      for (const id of q)
        for (const m of g.neighboursOf(id))
          if (!dist.has(m)) {
            dist.set(m, dist.get(id) + 1);
            n.push(m);
          }
      q = n;
    }
    return [...dist].find(([id, d]) => d >= 3 && v.notes.has(id))?.[0] ?? null;
  });
  await app(() => {
    const c = window.netnote.app.cards[0];
    c.repaint();
    const r = c.regionCenter('path');
    c.clickAt(r.x, r.y);
  });
  const picking = (await state(page)).pathPick;
  await app((id) => window.netnote.app.select(id), far);
  const s1 = await state(page);
  check(
    '"path to…" then a second note finds the chain of links',
    picking === 'Memory.md' && s1.path?.length >= 4 && s1.path.at(-1) === far,
    s1.path?.join(' → '),
  );
  check('the found path lights up and flows gold', s1.flows > 0);

  // the More row: time machine, tour, sound, motion
  await app(() => window.netnote.app.onDock('more'));
  check('"More" opens the row of extras above the menu', (await state(page)).tools);
  await app(() => window.netnote.app.onTool('time'));
  await page.waitForTimeout(150);
  const t0 = (await state(page)).timeMachine;
  await page.waitForTimeout(2500);
  const t1 = (await state(page)).timeMachine;
  check(
    'the time machine replays notes in the order they were born',
    t0 && t1 && t1.shown > t0.shown && t1.shown < t1.total,
    `${t0?.shown} → ${t1?.shown} / ${t1?.total}`,
  );
  const hidden = await app(() => {
    const g = window.netnote.app.graph;
    return g.nodes.filter((n) => !g.isBorn(n.id)).length;
  });
  check('notes not yet born are hidden', hidden > 0, `${hidden} hidden`);
  await app(() => window.netnote.app.onTool('time'));
  check('stopping it shows everything again', (await state(page)).timeMachine === null);

  await app(() => window.netnote.app.onTool('tour'));
  const before = (await state(page)).selected;
  await page.waitForTimeout(7600);
  const s2 = await state(page);
  check('the tour walks on to another note by itself', s2.touring && s2.selected && s2.selected !== before, `${before} → ${s2.selected}`);
  await app(() => window.netnote.app.select('Memory.md'));
  check('pinching anything stops the tour', !(await state(page)).touring);

  await app(() => window.netnote.app.onTool('sound'));
  await app(() => window.netnote.app.onTool('motion'));
  const s3 = await state(page);
  check('sound and motion can be switched off', !s3.sound && s3.reducedMotion);

  // the companion
  const pet = await state(page);
  check('the companion floats beside you', pet.companion.visible && pet.companion.enabled);
  await app(() => window.netnote.app.brain.poke(performance.now()));
  check('poking it gets an answer', !!(await state(page)).companion.speech);
  await app(() => window.netnote.app.onDock('new'));
  await page.waitForTimeout(1500);
  const writing = await state(page);
  check('it steps aside while you write', writing.composer && !writing.companion.visible, JSON.stringify({ composer: writing.composer, ...writing.companion }));
  await app(() => window.netnote.app.cancelComposer());
  await page.waitForTimeout(200);
  // editing a note block by block
  await app(() => window.netnote.app.select('Walking.md'));
  await page.waitForTimeout(300);
  const ed = await app(() => {
    const a = window.netnote.app;
    const c = a.cards[0];
    c.repaint();
    const r = c.regionCenter('edit');
    c.clickAt(r.x, r.y);
    const e = a.editor;
    e.repaint();
    return { open: e.mesh.visible, blocks: e.model.blocks.length };
  });
  check('"Edit" opens the note block by block', ed.open && ed.blocks >= 2, `${ed.blocks} blocks`);
  // the cursor: pinch inside the text to put it there, then type — the words go in at that spot
  await app(() => {
    const a = window.netnote.app;
    const e = a.editor;
    e.repaint();
    const b = e.regionCenter('block', '1');
    e.clickAt(b.x, b.y);
    a.input.setText('Walking clears the head.');
    e.repaint();
    const y = 146 + 38; // the first line of the text box
    let x = 60;
    while (x < 600 && e.caretAtPoint({ x, y }) !== 'Walking'.length) x += 2;
    e.clickAt(x, y);
  });
  await page.waitForTimeout(150);
  await page.keyboard.type(' often');
  await page.waitForTimeout(150);
  const cur = await app(() => ({ text: window.netnote.app.input.text, caret: window.netnote.app.input.caret }));
  check('pinching inside the text moves the cursor there, and typing inserts at it', cur.text === 'Walking often clears the head.', JSON.stringify(cur));
  const edited = await app(async () => {
    const a = window.netnote.app;
    const e = a.editor;
    const press = (id, data) => {
      e.repaint();
      const r = e.regionCenter(id, data);
      e.clickAt(r.x, r.y);
    };
    press('block', '1');
    const was = a.input.text;
    a.input.clear();
    a.input.setText('Walking loosens a stuck thought.');
    press('save');
    await new Promise((r) => setTimeout(r, 800));
    const raw = window.netnote.library.vault.notes.get('Walking.md').raw;
    return { was, raw, open: e.mesh.visible };
  });
  check(
    'changing one block and saving rewrites just that block',
    !edited.open && edited.raw.includes('Walking loosens a stuck thought.') && !edited.raw.includes(edited.was) && edited.raw.startsWith('---\ncreated:'),
    edited.was.slice(0, 40),
  );
  // the companion: beside the card, on top, with buttons that act
  await app(() => window.netnote.app.onTool('pet'));
  await app(() => window.netnote.app.onTool('pet'));
  const mochi = await app(async () => {
    const a = window.netnote.app;
    a.brain.poke(performance.now());
    await new Promise((r) => setTimeout(r, 600));
    const card = a.cards[0].mesh;
    const pos = a.companion.group.position;
    const local = card.worldToLocal(pos.clone());
    return {
      buttons: a.brain.speech?.buttons ?? [],
      pair: a.brain.speech?.pair,
      local: [local.x, local.y, local.z],
      cardW: a.cards[0].widthM,
      onTop: a.companion.bubble.mesh.material.depthTest === false,
    };
  });
  check(
    'it sits just outside the card, in front of it, and its bubble is never hidden',
    mochi.local[0] < -mochi.cardW / 2 && mochi.local[2] > 0 && mochi.onTop,
    mochi.local.map((x) => x.toFixed(2)).join(','),
  );
  check('a poke brings a possible link with Show / Connect / Not related', mochi.buttons.join() === 'show,connect,dismiss' && !!mochi.pair);
  const shown = await app(async () => {
    const a = window.netnote.app;
    const b = a.companion.bubble;
    b.repaint();
    const r = b.regionCenter('show');
    b.clickAt(r.x, r.y);
    const pair = a.brain.speech?.pair;
    await new Promise((r) => setTimeout(r, 400));
    return { selected: a.state.selected, pair, flows: a.state.flows };
  });
  check('"Show" opens the pair and lights the way between them', shown.selected === shown.pair?.[0] && shown.flows > 0);
  const n0 = await app(() => window.netnote.app.brain.waiting);
  await app(() => {
    const b = window.netnote.app.companion.bubble;
    b.repaint();
    const r = b.regionCenter('dismiss');
    b.clickAt(r.x, r.y);
  });
  const n1 = await app(() => window.netnote.app.brain.waiting);
  check('"Not related" drops the suggestion', n1 === n0 - 1, `${n0} → ${n1}`);
  await page.reload();
  await ready(page);
  const s4 = await state(page);
  check('your sound and motion choices are remembered', !s4.sound && s4.reducedMotion);
  check('no page errors (explore)', errors.length === 0, errors[0]);
  await ctx.close();
}

const server = process.env.E2E_URL ? null : await createServer({ server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server?.listen();
const browser = await launch();
try {
  await desktop(browser);
  await immersive(browser);
  await wall(browser);
  await insights(browser);
  await editing(browser);
  await explore(browser);
  await mixedReality(browser);
  await handsDirect(browser);
} catch (e) {
  check('scenario ran to the end', false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  await server?.close();
}
console.log(results.join('\n'));
process.exit(failed ? 1 : 0);
