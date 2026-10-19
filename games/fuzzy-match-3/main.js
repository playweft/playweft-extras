import { h, render } from "preact";
import { FuzzyMatch3App } from "./app.jsx";
import { PlayweftBridge } from "../../src/playweft-client.js";
import { createGameStorage } from "../../src/game-storage.js";
const root = document.getElementById("app");
let bridge;
function mount() {
  bridge = new PlayweftBridge();
  const storage = createGameStorage(bridge, {
    legacyKeys: ['playweft:fuzzy-match-3:v1', 'playweft:fruit-isle:v1'],
    migrationKey: 'playweft:fuzzy-match-3:storage-migrated:v1',
  });
  render(h(FuzzyMatch3App, { storage }), root);
}
function dispose() {
  render(null, root);
  bridge?.close();
}
function resume(event) {
  if (event.persisted) mount();
}
mount();
window.addEventListener("pagehide", dispose);
window.addEventListener("pageshow", resume);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    window.removeEventListener("pagehide", dispose);
    window.removeEventListener("pageshow", resume);
  });
