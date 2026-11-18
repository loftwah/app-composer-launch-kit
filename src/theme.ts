export type Theme = "light" | "dark";

/** The local preference shared by the editor and Help. */
export const THEME_KEY = "launch-kit:theme";

/**
 * The saved editor preference, falling back to the dark design when storage is
 * denied or holds anything other than an explicit light choice.
 */
export function savedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
