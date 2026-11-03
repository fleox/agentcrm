// Font choices. `system` is the default stack (no network request); the
// others are Google Fonts, loaded with a <link> to fonts.googleapis.com
// ONLY when the workspace picks one.

export interface FontDef {
  id: string;
  label: string;
  // CSS font-family value.
  family: string;
  // Google Fonts family name ("Inter", "IBM Plex Sans"); absent = local.
  google?: string;
}

const FALLBACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const SYSTEM_FONT_STACK = `Inter, ${FALLBACK}`;

function google(id: string, name: string): FontDef {
  return { id, label: name, family: `"${name}", ${FALLBACK}`, google: name };
}

export const FONTS: readonly FontDef[] = [
  { id: "system", label: "System (default)", family: SYSTEM_FONT_STACK },
  google("inter", "Inter"),
  google("geist", "Geist"),
  google("roboto", "Roboto"),
  google("open-sans", "Open Sans"),
  google("lato", "Lato"),
  google("source-sans-3", "Source Sans 3"),
  google("ibm-plex-sans", "IBM Plex Sans"),
  google("dm-sans", "DM Sans"),
  google("manrope", "Manrope"),
  google("work-sans", "Work Sans"),
  google("plus-jakarta-sans", "Plus Jakarta Sans"),
  google("figtree", "Figtree"),
  google("outfit", "Outfit"),
  google("nunito-sans", "Nunito Sans"),
  google("poppins", "Poppins"),
  google("space-grotesk", "Space Grotesk"),
];

export const DEFAULT_FONT = "system";

export function findFont(id: string | undefined): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export const GOOGLE_FONTS_ORIGIN = "https://fonts.googleapis.com";

// Stylesheet URL for a Google font (weights used by the UI), or null.
export function googleFontHref(id: string | undefined): string | null {
  const font = findFont(id);
  if (!font.google) return null;
  return `${GOOGLE_FONTS_ORIGIN}/css2?family=${encodeURIComponent(font.google).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
}
