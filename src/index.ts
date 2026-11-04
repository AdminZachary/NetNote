/**
 * Entry point: create the IWSDK world, open the notes library (IndexedDB, seeded with the sample on
 * first run), build the spatial app and the 2D landing page, and drive the app from an ECS system.
 */
import { createSystem, SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { chooseLibrary, sampleFiles } from './app/bootstrap';
import { detectLocale, setLocale, type Locale } from './app/i18n';
import { Library } from './app/library';
import { IdbStore } from './storage/store';
import { Landing } from './web/landing';
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

  const library = new Library(await IdbStore.open());
  const sample = sampleFiles(import.meta.glob<string>('/sample-vault/**/*.{md,canvas}', { query: '?raw', import: 'default', eager: true }));

  app = new NetNoteApp(world, library, { onExit: () => (landing.hidden = false) });

  const open = async (id: string): Promise<void> => {
    await library.open(id);
    storage.set(LAST, id);
  };
  const landing = new Landing(document.body, {
    library,
    support: await xrSupport(),
    open,
    enter: (mode) => {
      landing.hidden = true;
      world.launchXR(
        mode === 'ar'
          ? { sessionMode: SessionMode.ImmersiveAR, features: { handTracking: true, planeDetection: true, anchors: true, hitTest: true } }
          : { sessionMode: SessionMode.ImmersiveVR, features: { handTracking: true } },
      );
    },
    onLocale: (l: Locale) => {
      storage.set(LOCALE, l);
      app?.relabel();
    },
  });
  library.on('error', (e) => landing.toast(e.message));

  await open(await chooseLibrary(library, sample, storage.get(LAST)));
  await landing.refresh();
  document.documentElement.lang = saved ?? navigator.language;

  // test & debugging hook (also used by the end-to-end tests)
  (window as unknown as { netnote: unknown }).netnote = { world, library, app, landing };
}

main().catch((e: unknown) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#fff;background:#300;padding:16px;margin:0;white-space:pre-wrap';
  pre.textContent = e instanceof Error ? (e.stack ?? e.message) : String(e);
  document.body.prepend(pre);
});
