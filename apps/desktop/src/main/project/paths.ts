/**
 * Pure path/range/mime helpers for the smoothcut:// protocol (no electron
 * imports so they stay unit-testable).
 */
import { isAbsolute, normalize, resolve, sep } from 'node:path';

/**
 * Resolve `relPath` strictly inside `baseDir`. Returns null for traversal
 * attempts (.., absolute paths, encoded tricks — anything escaping baseDir).
 */
export function resolveInside(baseDir: string, relPath: string): string | null {
  if (relPath.includes('\0') || isAbsolute(relPath)) return null;
  const base = normalize(resolve(baseDir));
  const full = normalize(resolve(base, relPath));
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range: bytes=...` header against a file of `size`
 * bytes. Returns null when the header is absent/malformed/unsatisfiable —
 * callers respond 200 (absent) or 416.
 */
export function parseRangeHeader(header: string | null, size: number): ByteRange | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';
  if (startStr === '' && endStr === '') return null;

  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (suffix === 0) return null;
    const start = Math.max(0, size - suffix);
    return size > 0 ? { start, end: size - 1 } : null;
  }

  const start = Number(startStr);
  if (start >= size) return null;
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1);
  if (end < start) return null;
  return { start, end };
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  png: 'image/png',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
};

export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
