import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { mimeForPath, parseRangeHeader, resolveInside } from './paths.js';
import type { ProjectStore } from './store.js';

export const SMOOTHCUT_SCHEME = 'smoothcut';

/** Must run BEFORE app ready. */
export function registerSmoothcutSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SMOOTHCUT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        // The renderer origin (dev server / file) differs from smoothcut://,
        // so fetch() of events.jsonl needs CORS.
        corsEnabled: true,
      },
    },
  ]);
}

const COMMON_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Access-Control-Allow-Origin': '*',
  // fetch() from the renderer origin may only read safelisted response
  // headers unless exposed — mediabunny needs the range/length metadata.
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
} as const;

function errorResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain', ...COMMON_HEADERS },
  });
}

/**
 * smoothcut://bundle/<projectId>/<relPath> → streamed file from the bundle
 * dir, with single-range support (video seeking needs 206 + Content-Range).
 */
export function registerSmoothcutProtocol(store: ProjectStore): void {
  protocol.handle(SMOOTHCUT_SCHEME, async (request) => {
    // CORS preflight (a fetch() with a Range header is not a "simple" request).
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return errorResponse(400, 'bad url');
    }
    if (url.host !== 'bundle') return errorResponse(404, 'unknown host');

    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    const projectId = segments[0];
    if (projectId === undefined || segments.length < 2) {
      return errorResponse(404, 'missing path');
    }
    const relPath = segments.slice(1).map(decodeURIComponent).join('/');

    const filePath = resolveInside(store.bundleDir(decodeURIComponent(projectId)), relPath);
    if (filePath === null) return errorResponse(403, 'forbidden');

    let size: number;
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return errorResponse(404, 'not found');
      size = info.size;
    } catch {
      return errorResponse(404, 'not found');
    }

    const mime = mimeForPath(filePath);
    const rangeHeader = request.headers.get('range');
    const range = parseRangeHeader(rangeHeader, size);
    if (rangeHeader !== null && range === null) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, ...COMMON_HEADERS },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    // node:stream/web ReadableStream vs the fetch BodyInit nominal mismatch.
    const body =
      size === 0 || request.method === 'HEAD'
        ? null
        : (Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ConstructorParameters<
            typeof Response
          >[0]);

    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size === 0 ? 0 : end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        ...COMMON_HEADERS,
      },
    });
  });
}
