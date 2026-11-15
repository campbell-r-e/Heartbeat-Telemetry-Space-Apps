// Dark by default, light by choice (SPEC §9.1). The choice lives in a cookie that an inline
// script reads before the first paint (Next.js "Preventing flash before hydration" guide), so the
// root layout stays static and pages never flash the wrong theme.

import { ONE_YEAR_S } from "./domain/time";

export type Theme = "dark" | "light";

export const THEME_COOKIE = "theme";
export const DEFAULT_THEME: Theme = "dark";
const THEME_COOKIE_MAX_AGE_S = ONE_YEAR_S;

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" ? "light" : DEFAULT_THEME;
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** The cookie that remembers a theme choice. */
export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_COOKIE_MAX_AGE_S}; samesite=lax`;
}

/**
 * Runs in <head> before paint: applies a saved light theme. If cookies are unreadable the page
 * simply keeps the dark default, which is the intended fallback.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);if(m&&m[1]==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}})()`;
