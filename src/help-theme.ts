import { savedTheme } from "./theme.js";

// Reapply the editor's saved choice to the static Help page. Dark is the CSS
// default, so leaving this unrun (no JS) or unable to read storage still gives
// a complete, readable Help page.
document.documentElement.dataset.theme = savedTheme();
