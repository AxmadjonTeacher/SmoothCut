import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mimeForPath, parseRangeHeader, resolveInside } from './paths.js';

const base = '/bundles/abc.smoothcut';

describe('resolveInside', () => {
  it('resolves plain relative paths inside the base', () => {
    expect(resolveInside(base, 'recording/screen.mp4')).toBe(
      join(base, 'recording', 'screen.mp4'),
    );
  });

  it('rejects traversal and absolute paths', () => {
    expect(resolveInside(base, '../other/secret')).toBeNull();
    expect(resolveInside(base, 'recording/../../etc/passwd')).toBeNull();
    expect(resolveInside(base, '/etc/passwd')).toBeNull();
    expect(resolveInside(base, 'a/\0b')).toBeNull();
  });

  it('rejects a sibling dir sharing the base prefix', () => {
    expect(resolveInside(base, '../abc.smoothcut-evil/x')).toBeNull();
  });
});

describe('parseRangeHeader', () => {
  it('parses bounded, open-ended and suffix ranges', () => {
    expect(parseRangeHeader('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRangeHeader('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('clamps end to the file size', () => {
    expect(parseRangeHeader('bytes=0-999999', 100)).toEqual({ start: 0, end: 99 });
  });

  it('rejects malformed or unsatisfiable ranges', () => {
    expect(parseRangeHeader(null, 1000)).toBeNull();
    expect(parseRangeHeader('bytes=abc', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=1000-', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=50-40', 1000)).toBeNull();
    expect(parseRangeHeader('bytes=-', 1000)).toBeNull();
  });
});

describe('mimeForPath', () => {
  it('maps known media extensions', () => {
    expect(mimeForPath('/a/screen.mp4')).toBe('video/mp4');
    expect(mimeForPath('/a/cam.webm')).toBe('video/webm');
    expect(mimeForPath('/a/cursors/arrow.PNG')).toBe('image/png');
    expect(mimeForPath('/a/project.json')).toBe('application/json');
    expect(mimeForPath('/a/events.jsonl')).toBe('application/x-ndjson');
    expect(mimeForPath('/a/unknown.bin')).toBe('application/octet-stream');
  });
});
