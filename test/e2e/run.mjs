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
  check('landing page is shown', await page.isVisible('[data-testid=landing]'));
  const n = await page.evaluate(() => window.netnote.library.vault.notes.size);
  check('sample library is seeded on first run', n >= 30, `${n} notes`);
  const pt = await page.evaluate(() => {
    const { app, world } = window.netnote;
    const p = app.graph.worldPos('Memory.md').clone().project(world.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(800);
  const s = await state(page);
  check('clicking a star opens its card (desktop preview)', s.cards[0] === 'Memory.md', JSON.stringify(s.cards));
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
  // the map in your hand: pick a note and the big graph glides it in front of you
  await page.evaluate(() => window.netnote.app.onDock('map'));
  await page.waitForTimeout(600);
  const jumped = await page.evaluate(async () => {
    const { app } = window.netnote;
    const visible = app.state.minimap;
    app.minimap.onPick('Walking.md');
    await new Promise((r) => setTimeout(r, 700));
    const head = app.world.camera.position;
    const p = app.graph.worldPos('Walking.md');
    return { visible, selected: app.state.selected, dist: p.distanceTo(head) };
  });
  check('the map in your hand shows', jumped.visible);
  check(
    'picking a note on the map brings it in front of you',
    jumped.selected === 'Walking.md' && Math.abs(jumped.dist - 1.4) < 0.15,
    `${jumped.dist.toFixed(2)} m`,
  );
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
  check('no page errors (mixed reality)', errors.length === 0, errors[0]);
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
} catch (e) {
  check('scenario ran to the end', false, e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
  await server?.close();
}
console.log(results.join('\n'));
process.exit(failed ? 1 : 0);
