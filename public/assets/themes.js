// Seven-theme switcher for the dashboard. The chosen theme is stored in
// localStorage under "ca-theme" and applied to <html data-theme>.

export const THEMES = [
  ["midnight", "Midnight", "#6d8bff"],
  ["daylight", "Daylight", "#3457d5"],
  ["aurora", "Aurora", "#34d39d"],
  ["ember", "Ember", "#ff7a3d"],
  ["violet", "Violet", "#a78bfa"],
  ["sand", "Sand", "#a05a1c"],
  ["contrast", "High contrast", "#ffff00"],
];

export function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem("ca-theme", name); } catch { /* private mode */ }
}

export function currentTheme() {
  return document.documentElement.dataset.theme || "midnight";
}

// Mount a row of theme dots into `host` and keep it in sync.
export function mountSwitcher(host) {
  if (!host) return;
  const render = () => {
    host.replaceChildren(
      ...THEMES.map(([id, label, color]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "theme-dot";
        b.title = label;
        b.setAttribute("aria-label", `Theme ${label}`);
        b.setAttribute("aria-pressed", String(currentTheme() === id));
        b.style.setProperty("--dot", color);
        b.onclick = () => { applyTheme(id); render(); };
        return b;
      }),
    );
  };
  render();
}
