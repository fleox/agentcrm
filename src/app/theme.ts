import { useCallback, useEffect, useState } from "react";

// Dark mode: class strategy on <html>, persisted in localStorage
// "agentcrm.theme" (read synchronously by index.html to avoid a flash).

export type Theme = "light" | "dark";
const KEY = "agentcrm.theme";

export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not persisted.
  }
  window.dispatchEvent(new CustomEvent("agentcrm:theme", { detail: theme }));
}

export function useTheme(): { theme: Theme; toggle(): void; setTheme(t: Theme): void } {
  const [theme, set] = useState<Theme>(currentTheme);
  useEffect(() => {
    const on = (e: Event) => set((e as CustomEvent<Theme>).detail);
    window.addEventListener("agentcrm:theme", on);
    return () => window.removeEventListener("agentcrm:theme", on);
  }, []);
  const setTheme = useCallback((t: Theme) => applyTheme(t), []);
  return { theme, setTheme, toggle: () => applyTheme(theme === "dark" ? "light" : "dark") };
}
