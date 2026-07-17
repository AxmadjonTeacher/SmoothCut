#!/usr/bin/env node
/**
 * Generates apps/desktop/resources/{icon.png,icon.icns,icon.ico} with zero
 * dependencies: pixels are rendered analytically (SDF coverage, so every size
 * is crisp — no resampling), PNG encoding is hand-rolled over node:zlib, the
 * .ico embeds PNG entries (Vista+ format), and the .icns is assembled by the
 * macOS `iconutil` tool (skipped with a warning on other platforms).
 *
 * Design: macOS-grid rounded rect, violet→blue diagonal gradient, white
 * record-button glyph (ring + play triangle).
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESOURCES = join(ROOT, 'resources');

// ---------------------------------------------------------------------------
// PNG encoder (RGBA8, no interlace, filter 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** rgba: Uint8Array of size*size*4. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Analytic rendering (signed distance fields → antialiased coverage)
// ---------------------------------------------------------------------------

function sdRoundedRect(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** Signed distance to a triangle (negative inside). */
function sdTriangle(px, py, v) {
  const [a, b, c] = v;
  const dists = [sdSegment(px, py, a[0], a[1], b[0], b[1]), sdSegment(px, py, b[0], b[1], c[0], c[1]), sdSegment(px, py, c[0], c[1], a[0], a[1])];
  const cross = (ox, oy, ax, ay, bx, by) => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  const s1 = cross(a[0], a[1], b[0], b[1], px, py);
  const s2 = cross(b[0], b[1], c[0], c[1], px, py);
  const s3 = cross(c[0], c[1], a[0], a[1], px, py);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  const d = Math.min(...dists);
  return inside ? -d : d;
}

/** SDF → coverage in [0,1] with ~1px antialiasing. */
function coverage(sd) {
  return Math.min(1, Math.max(0, 0.5 - sd));
}

function renderIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  // macOS icon grid: artwork occupies ~824/1024 of the canvas.
  const margin = (100 / 1024) * size;
  const rect = size - margin * 2;
  const cx = size / 2;
  const cy = size / 2;
  const cornerR = 0.225 * rect;

  // Record-button glyph: ring + play triangle, slightly optically centered.
  const ringR = 0.335 * rect;
  const ringW = 0.062 * rect;
  const triR = 0.175 * rect;
  const triRound = 0.035 * rect;
  const triCx = cx + 0.022 * rect; // optical centering of the play triangle
  const tri = [
    [triCx + triR, cy],
    [triCx + triR * Math.cos((2 * Math.PI) / 3), cy + triR * Math.sin((2 * Math.PI) / 3)],
    [triCx + triR * Math.cos((2 * Math.PI) / 3), cy - triR * Math.sin((2 * Math.PI) / 3)],
  ];

  // Gradient endpoints (violet → blue), diagonal.
  const top = [139, 92, 246]; // #8b5cf6
  const bottom = [37, 99, 235]; // #2563eb

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const rectCov = coverage(sdRoundedRect(px, py, cx, cy, rect / 2, rect / 2, cornerR));
      if (rectCov <= 0) continue;

      // Diagonal gradient + subtle top sheen.
      const t = Math.min(1, Math.max(0, (px + py) / (2 * size)));
      const sheen = Math.max(0, 1 - (py - margin) / (rect * 0.6)) * 0.12;
      let r = top[0] + (bottom[0] - top[0]) * t;
      let g = top[1] + (bottom[1] - top[1]) * t;
      let b = top[2] + (bottom[2] - top[2]) * t;
      r += (255 - r) * sheen;
      g += (255 - g) * sheen;
      b += (255 - b) * sheen;

      // White glyph: ring ∪ rounded play triangle.
      const dRing = Math.abs(Math.hypot(px - cx, py - cy) - ringR) - ringW / 2;
      const dTri = sdTriangle(px, py, tri) - triRound;
      const glyphCov = coverage(Math.min(dRing, dTri));
      r += (255 - r) * glyphCov;
      g += (255 - g) * glyphCov;
      b += (255 - b) * glyphCov;

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(rectCov * 255);
    }
  }
  return rgba;
}

const pngCache = new Map();
function pngAt(size) {
  let png = pngCache.get(size);
  if (!png) {
    png = encodePng(size, renderIcon(size));
    pngCache.set(size, png);
  }
  return png;
}

// ---------------------------------------------------------------------------
// Containers: .ico (PNG entries) and .icns (via iconutil)
// ---------------------------------------------------------------------------

function writeIco(path, sizes) {
  const pngs = sizes.map((s) => pngAt(s));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; // 0 means 256
    e[1] = s >= 256 ? 0 : s;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  writeFileSync(path, Buffer.concat([header, ...entries, ...pngs]));
}

function writeIcns(path) {
  if (process.platform !== 'darwin') {
    console.warn('[icons] skipping icon.icns (iconutil is macOS-only)');
    return;
  }
  const iconset = join(RESOURCES, 'icon.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  for (const [name, size] of entries) writeFileSync(join(iconset, name), pngAt(size));
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path]);
  rmSync(iconset, { recursive: true, force: true });
}

mkdirSync(RESOURCES, { recursive: true });
writeFileSync(join(RESOURCES, 'icon.png'), pngAt(1024));
writeIco(join(RESOURCES, 'icon.ico'), [16, 24, 32, 48, 64, 128, 256]);
writeIcns(join(RESOURCES, 'icon.icns'));
console.log('[icons] wrote resources/icon.png, icon.ico, icon.icns');
