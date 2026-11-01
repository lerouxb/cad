export type ThemeMode = "day" | "night";
export type Highlight = "yellow" | "pink" | "blue" | "green";

export interface ThemeSettings {
  mode: ThemeMode;
  highlight: Highlight;
}

export const THEME_KEY = "cad.theme";
export const HIGHLIGHT_KEY = "cad.highlight";

export const DEFAULT_THEME: ThemeSettings = { mode: "day", highlight: "yellow" };

const HIGHLIGHTERS: Record<
  Highlight,
  { day: string; night: string; daySoft: string; nightSoft: string; ink: string }
> = {
  yellow: {
    day: "#ddff00",
    night: "#d8ff3e",
    daySoft: "rgba(221, 255, 0, 0.42)",
    nightSoft: "rgba(216, 255, 62, 0.32)",
    ink: "#101010",
  },
  pink: {
    day: "#ff5cbc",
    night: "#ff79c9",
    daySoft: "rgba(255, 92, 188, 0.36)",
    nightSoft: "rgba(255, 121, 201, 0.3)",
    ink: "#101010",
  },
  blue: {
    day: "#3ec8ff",
    night: "#48d0ff",
    daySoft: "rgba(62, 200, 255, 0.36)",
    nightSoft: "rgba(72, 208, 255, 0.3)",
    ink: "#101010",
  },
  green: {
    day: "#45f08a",
    night: "#53ff98",
    daySoft: "rgba(69, 240, 138, 0.36)",
    nightSoft: "rgba(83, 255, 152, 0.3)",
    ink: "#101010",
  },
};

export function loadTheme(): ThemeSettings {
  try {
    const mode = localStorage.getItem(THEME_KEY) === "night" ? "night" : "day";
    const raw = localStorage.getItem(HIGHLIGHT_KEY);
    const highlight: Highlight =
      raw === "pink" || raw === "blue" || raw === "green" || raw === "yellow"
        ? raw
        : DEFAULT_THEME.highlight;
    return { mode, highlight };
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(settings: ThemeSettings): void {
  const root = document.documentElement;
  root.dataset.theme = settings.mode;
  root.dataset.highlight = settings.highlight;
  root.style.colorScheme = settings.mode === "night" ? "dark" : "light";
  root.style.backgroundColor = settings.mode === "night" ? "#111110" : "#fbfbf9";
  try {
    localStorage.setItem(THEME_KEY, settings.mode);
    localStorage.setItem(HIGHLIGHT_KEY, settings.highlight);
  } catch {
    // Private mode or storage disabled: the theme still works for this session.
  }
}

export interface SketchPalette {
  under: string;
  full: string;
  conflict: string;
  selected: string;
  ink: string;
  muted: string;
  dim: string;
  grid: string;
  gridMajor: string;
  axis: string;
  construction: string;
  dimension: string;
  reference: string;
  badge: string;
  halo: string;
  pointFill: string;
  snap: string;
  hover: string;
  marker: string;
  markerSoft: string;
  markerInk: string;
  danger: string;
}

export function sketchPalette(settings: ThemeSettings): SketchPalette {
  const marker = HIGHLIGHTERS[settings.highlight];
  if (settings.mode === "night") {
    return {
      under: "#c4c0b4",
      full: "#f2efe3",
      conflict: "#f2efe3",
      selected: "#f2efe3",
      ink: "#f2efe3",
      muted: "#c4c0b4",
      dim: "#807d72",
      grid: "rgba(242, 239, 227, 0.06)",
      gridMajor: "rgba(242, 239, 227, 0.12)",
      axis: "rgba(242, 239, 227, 0.28)",
      construction: "#807d72",
      dimension: "#c4c0b4",
      reference: "#807d72",
      badge: "#807d72",
      halo: "#111110",
      pointFill: "#111110",
      snap: "#c4c0b4",
      hover: "#f2efe3",
      marker: marker.night,
      markerSoft: marker.nightSoft,
      markerInk: marker.ink,
      danger: "#f2efe3",
    };
  }
  return {
    under: "#47453e",
    full: "#141412",
    conflict: "#141412",
    selected: "#141412",
    ink: "#141412",
    muted: "#47453e",
    dim: "#87847a",
    grid: "rgba(20, 20, 18, 0.06)",
    gridMajor: "rgba(20, 20, 18, 0.12)",
    axis: "rgba(20, 20, 18, 0.28)",
    construction: "#87847a",
    dimension: "#47453e",
    reference: "#87847a",
    badge: "#87847a",
    halo: "#fbfbf9",
    pointFill: "#fbfbf9",
    snap: "#47453e",
    hover: "#141412",
    marker: marker.day,
    markerSoft: marker.daySoft,
    markerInk: marker.ink,
    danger: "#141412",
  };
}

export function highlighterColor(
  highlight: Highlight,
  mode: ThemeMode,
): { color: string; soft: string } {
  const entry = HIGHLIGHTERS[highlight];
  return mode === "night"
    ? { color: entry.night, soft: entry.nightSoft }
    : { color: entry.day, soft: entry.daySoft };
}
