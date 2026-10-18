import { h, render } from "preact";
import { ArrowLeft } from "lucide-preact";

render(
  h(ArrowLeft, { size: 16, strokeWidth: 1.7, "aria-hidden": "true" }),
  document.getElementById("help-back-icon"),
);
