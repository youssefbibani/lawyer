const SETTINGS_KEY = "qasr-al-adala:settings";

interface StoredAppearance {
  theme?: "light" | "dark";
  fontSize?: "small" | "medium" | "large";
}

function readAppearance(): StoredAppearance {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as StoredAppearance) : {};
  } catch {
    return {};
  }
}

export function getStoredTheme(): "light" | "dark" {
  return readAppearance().theme === "dark" ? "dark" : "light";
}

export function getStoredFontSize(): "small" | "medium" | "large" {
  const size = readAppearance().fontSize;
  return size === "small" || size === "large" ? size : "medium";
}

export function applyTheme(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0D0D0D" : "#1A1A2E");
}

export function applyFontSize(size: "small" | "medium" | "large") {
  if (size === "medium") document.documentElement.removeAttribute("data-font-size");
  else document.documentElement.setAttribute("data-font-size", size);
}
