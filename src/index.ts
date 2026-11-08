/**
 * Entry point: create the IWSDK world, open the notes library (IndexedDB, seeded with the sample on
 * first run), build the spatial app and the 2D landing page, and drive the app from an ECS system.
 */
import { createSystem, SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { chooseLibrary, sampleFiles } from './app/bootstrap';
import { detectLocale, getLocale, setLocale, type Locale } from './app/i18n';
import { Library } from './app/library';
import { IdbStore } from './storage/store';
import { Landing } from './web/landing';
import { Workspace } from './web/workspace';
import { NetNoteApp } from './xr/app';

const LAST = 'netnote.last';
const LOCALE = 'netnote.locale';

const storage = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: fine */
    }
  },
};

let app: NetNoteApp | null = null;

/** Runs the spatial app once per frame inside the IWSDK loop. */
class NetNoteSystem extends createSystem({}) {
  update(delta: number): void {
    app?.update(Math.min(delta, 0.1));
  }
}

/**
 * An error thrown anywhere inside a frame would stop the render loop for good (the next frame is only
 * requested after this one returns), which in a headset looks like a frozen app. Log it and carry on.
 */
function keepLoopAlive(world: World): void {
  const step = world.update.bind(world);
  let reported = 0;
  world.update = (delta: number, time: number): void => {
    try {
      step(delta, time);
    } catch (err) {
      if (reported++ < 5) console.error('frame error (recovered)', err);
    }
  };
}

/**
 * Crisp everywhere you look: three.js asks the headset for maximum foveation by default (only the
 * middle of the view at full resolution), and the browser's default framebuffer is below the Quest 3
 * panel. Text is the whole point of this app, so: no foveation, and a framebuffer at panel resolution.
 * The scene is light (points, lines and a few canvas panels), so the headset keeps its frame rate.
 */
function sharpen(world: World): void {
  const xr = world.renderer.xr;
  xr.setFoveation(0);
  xr.setFramebufferScaleFactor(1.25);
  // some runtimes reset foveation when the session starts: set it again then
  xr.addEventListener('sessionstart', () => xr.setFoveation(0));
}

async function xrSupport(): Promise<{ vr: boolean; ar: boolean }> {
  const xr = navigator.xr;
  if (!xr) return { vr: false, ar: false };
  const [vr, ar] = await Promise.all([xr.isSessionSupported('immersive-vr').catch(() => false), xr.isSessionSupported('immersive-ar').catch(() => false)]);
  return { vr, ar };
}

async function main(): Promise<void> {
  const saved = storage.get(LOCALE);
  setLocale(saved === 'zh' || saved === 'en' ? saved : detectLocale());

  const container = document.getElementById('scene-container') as HTMLDivElement;
  const world = await World.create(container, projectOptions);
  world.registerSystem(NetNoteSystem);
  keepLoopAlive(world);
  sharpen(world);

  const library = new Library(await IdbStore.open());
  const sample = sampleFiles(import.meta.glob<string>('/sample-vault/**/*.{md,canvas}', { query: '?raw', import: 'default', eager: true }));

  app = new NetNoteApp(world, library, { onExit: () => (workspace.hidden = false) });

  const open = async (id: string): Promise<void> => {
    await library.open(id);
    storage.set(LAST, id);
  };
  const support = await xrSupport();
  const landing = new Landing(document.body, {
    library,
    support,
    open,
    close: () => (landing.hidden = true),
  });
  landing.hidden = true;
  const workspace = new Workspace(document.body, {
    library,
    support,
    enter: (mode) => {
      landing.hidden = true;
      workspace.hidden = true;
      world.launchXR(
        mode === 'ar'
          ? { sessionMode: SessionMode.ImmersiveAR, features: { handTracking: true, planeDetection: true, anchors: true, hitTest: true } }
          : { sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true } },
      );
    },
    toggleLibrary: () => (landing.hidden = !landing.hidden),
    onLocale: () => {
      const next: Locale = getLocale() === 'zh' ? 'en' : 'zh';
      setLocale(next);
      storage.set(LOCALE, next);
      app?.relabel();
      workspace.render();
      landing.render();
    },
    // the 3D preview behind the page: when you come back, open the note you were looking at there
    onPreview: (on) => {
      if (!on && app?.graph.selected) void workspace.open(app.graph.selected);
    },
    toast: (text) => landing.toast(text),
  });
  library.on('error', (e) => landing.toast(e.message));

  await open(await chooseLibrary(library, sample, storage.get(LAST)));
  await landing.refresh();
  workspace.render();
  document.documentElement.lang = saved ?? navigator.language;

  // test & debugging hook (also used by the end-to-end tests)
  (window as unknown as { netnote: unknown }).netnote = { world, library, app, landing, workspace };
}

main().catch((e: unknown) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#fff;background:#300;padding:16px;margin:0;white-space:pre-wrap';
  pre.textContent = e instanceof Error ? (e.stack ?? e.message) : String(e);
  document.body.prepend(pre);
});
