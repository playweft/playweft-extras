import { h, render } from "preact";
import { FuzzyMatch3App } from "./app.jsx";
import { PlayweftBridge } from "../../src/playweft-client.js";
const root = document.getElementById("app");
let bridge;
function mount() {
  bridge = new PlayweftBridge();
  render(h(FuzzyMatch3App), root);
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
