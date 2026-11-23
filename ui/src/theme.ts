import { useCallback, useEffect, useState } from 'react';
import type { NodeKind } from './utils/nodeKinds';

export type ThemeName = 'dark' | 'light';
export type RGB = readonly [number, number, number];

export interface CanvasPalette {
  background: string;
  kind: Record<NodeKind | 'default', RGB>;
  language: Record<string, RGB>;
  /** Hover, selection and path highlight. */
  accent: RGB;
  link: RGB;
  label: RGB;
  minimapViewport: string;
}

const DARK: CanvasPalette = {
  background: '#161618',
  kind: {
    files: [162, 167, 182],
    folders: [244, 214, 118],
    functions: [209, 154, 102],
    classes: [86, 182, 194],
    structs: [97, 175, 239],
    interfaces: [152, 195, 121],
    traits: [130, 205, 160],
    enums: [198, 120, 221],
    types: [224, 108, 117],
    imports: [142, 186, 175],
    default: [162, 167, 182],
  },
  language: {
    rust: [222, 165, 132],
    typescript: [64, 150, 230],
    javascript: [240, 216, 60],
    python: [114, 159, 207],
    go: [0, 172, 215],
    c: [168, 187, 217],
    cpp: [100, 140, 220],
    default: [162, 167, 182],
  },
  accent: [244, 214, 118],
  link: [162, 167, 182],
  label: [232, 230, 225],
  minimapViewport: 'rgba(244, 214, 118, 0.85)',
};

const LIGHT: CanvasPalette = {
  background: '#f2f3f5',
  kind: {
    files: [92, 99, 114],
    folders: [154, 106, 0],
    functions: [190, 104, 30],
    classes: [16, 128, 142],
    structs: [32, 110, 200],
    interfaces: [66, 138, 46],
    traits: [30, 140, 100],
    enums: [150, 60, 180],
    types: [196, 52, 72],
    imports: [70, 130, 115],
    default: [92, 99, 114],
  },
  language: {
    rust: [176, 96, 50],
    typescript: [36, 104, 190],
    javascript: [160, 130, 0],
    python: [48, 100, 160],
    go: [0, 125, 160],
    c: [80, 96, 140],
    cpp: [40, 80, 170],
    default: [92, 99, 114],
  },
  accent: [196, 136, 0],
  link: [100, 106, 120],
  label: [27, 27, 31],
  minimapViewport: 'rgba(154, 106, 0, 0.9)',
};

export const PALETTES: Record<ThemeName, CanvasPalette> = { dark: DARK, light: LIGHT };

export const rgba = (rgb: RGB, alpha: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;

/** Mixes a color toward white (dark theme) or black (light theme) for "neighbor" emphasis. */
export const emphasize = (rgb: RGB, theme: ThemeName): RGB => {
  const target = theme === 'dark' ? 255 : 0;
  const t = 0.25;
  return [
    Math.round(rgb[0] + (target - rgb[0]) * t),
    Math.round(rgb[1] + (target - rgb[1]) * t),
    Math.round(rgb[2] + (target - rgb[2]) * t),
  ];
};

const STORAGE_KEY = 'codite.theme';

const initialTheme = (): ThemeName => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // ignore blocked storage
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[theme].background);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore blocked storage
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
};
