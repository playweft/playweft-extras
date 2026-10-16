import { h, render } from "preact";
import { PupdokuApp } from "./app.jsx";
import { createPupdokuController } from "./controller.js";
import { PlayweftBridge } from "../../src/playweft-client.js";

const root = document.getElementById("app");
let controller, bridge;
function mount() {
  controller = createPupdokuController();
  bridge = new PlayweftBridge();
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
document.addEventListener("visibilitychange", suspend);
window.addEventListener("pagehide", dispose);
window.addEventListener("pageshow", resume);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    document.removeEventListener("visibilitychange", suspend);
    window.removeEventListener("pagehide", dispose);
    window.removeEventListener("pageshow", resume);
  });
