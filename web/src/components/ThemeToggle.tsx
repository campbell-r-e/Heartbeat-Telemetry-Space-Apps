"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, otherTheme, parseTheme, themeCookie, type Theme } from "@/lib/theme";
import styles from "./controls.module.css";

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

/** The theme is the data-theme attribute on <html>; watch it so every toggle stays in sync. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const readTheme = (): Theme => parseTheme(document.documentElement.dataset.theme);
const serverTheme = (): Theme => DEFAULT_THEME;

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.cookie = themeCookie(theme);
}

export function ThemeToggle({ onPage = false }: { onPage?: boolean }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const next = otherTheme(theme);
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={`Switch to ${next} mode`}
      className={`${styles.button} ${onPage ? styles.onPage : ""}`}
    >
      <MoonIcon />
      <span>{next === "light" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
