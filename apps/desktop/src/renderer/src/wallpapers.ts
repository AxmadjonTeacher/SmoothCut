/**
 * Bundled wallpaper backgrounds. `project.json` persists only the stable id
 * (background {kind:'wallpaper', value:id}); the hashed asset URLs below are
 * resolved at build time and work in both the editor window and the export
 * worker chunk.
 */
export interface WallpaperAsset {
  id: string;
  label: string;
  url: string;
}

export const WALLPAPERS: WallpaperAsset[] = [
  {
    id: 'macbook-1',
    label: 'Big Sur Night',
    url: new URL('./assets/wallpapers/macbook-1.jpg', import.meta.url).href,
  },
  {
    id: 'macbook-2',
    label: 'Ventura Dark',
    url: new URL('./assets/wallpapers/macbook-2.jpg', import.meta.url).href,
  },
  {
    id: 'macbook-3',
    label: 'Tahoe Light',
    url: new URL('./assets/wallpapers/macbook-3.jpg', import.meta.url).href,
  },
];

export const WALLPAPER_URLS: Record<string, string> = Object.fromEntries(
  WALLPAPERS.map((w) => [w.id, w.url]),
);
