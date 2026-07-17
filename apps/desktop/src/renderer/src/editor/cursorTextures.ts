/**
 * Loads `cursors/<shapeId>.png` images into pixi Textures for the scene's
 * CursorTextureProvider. `get` returns null while a shape is still loading —
 * the engine falls back to its built-in arrow.
 *
 * Textures are built through the engine's FrameTexture so they are instances
 * of the exact pixi Texture class the SceneRenderer type-checks against
 * (pixi.js itself is not a direct dependency of this app).
 */
import { FrameTexture } from '@smoothcut/engine';
import type { CursorTextureProvider } from '@smoothcut/engine';

export interface CursorTextureManager extends CursorTextureProvider {
  preload(shapeIds: readonly string[]): void;
  destroy(): void;
}

interface Entry {
  frame: FrameTexture;
  texture: unknown | null;
  bitmap: ImageBitmap | null;
}

export function createCursorTextureManager(
  cursorsBase: string,
  onLoad: () => void,
): CursorTextureManager {
  const entries = new Map<string, Entry>();
  let destroyed = false;

  const load = (shapeId: string): void => {
    if (destroyed || entries.has(shapeId)) return;
    const entry: Entry = { frame: new FrameTexture(), texture: null, bitmap: null };
    entries.set(shapeId, entry);
    void (async () => {
      try {
        const res = await fetch(cursorsBase + encodeURIComponent(shapeId) + '.png');
        if (!res.ok) return;
        const bitmap = await createImageBitmap(await res.blob());
        if (destroyed) {
          bitmap.close();
          return;
        }
        entry.bitmap = bitmap;
        entry.texture = entry.frame.update(bitmap);
        onLoad();
      } catch {
        // Missing/broken cursor image: engine keeps the default arrow.
      }
    })();
  };

  return {
    get(shapeId: string): unknown | null {
      const entry = entries.get(shapeId);
      if (!entry) {
        load(shapeId);
        return null;
      }
      return entry.texture;
    },
    preload(shapeIds: readonly string[]): void {
      for (const id of shapeIds) load(id);
    },
    destroy(): void {
      destroyed = true;
      for (const entry of entries.values()) {
        entry.frame.destroy();
        entry.bitmap?.close();
      }
      entries.clear();
    },
  };
}
