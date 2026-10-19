import { h, render } from 'preact';
import { PupdokuApp } from './app.jsx';
import { createPupdokuController, STORAGE_KEY } from './controller.js';
import { PlayweftBridge } from '../../src/playweft-client.js';
import { createGameStorage } from '../../src/game-storage.js';

const root = document.getElementById('app');
let controller, bridge;
function mount() {
  bridge = new PlayweftBridge();
  controller = createPupdokuController({
    storage: createGameStorage(bridge, {
      legacyKeys: [STORAGE_KEY],
      migrationKey: 'playweft:pupdoku:storage-migrated:v1',
    }),
  });
  render(h(PupdokuApp, { controller }), root);
  controller.start();
}
function dispose() {
  controller.dispose();
  bridge.close();
  render(null, root);
}
const suspend = () => controller.suspend();
const resume = (event) => {
  if (event.persisted) mount();
};
mount();
document.addEventListener('visibilitychange', suspend);
window.addEventListener('pagehide', dispose);
window.addEventListener('pageshow', resume);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    document.removeEventListener('visibilitychange', suspend);
    window.removeEventListener('pagehide', dispose);
    window.removeEventListener('pageshow', resume);
  });
