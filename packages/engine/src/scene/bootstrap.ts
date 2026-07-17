/**
 * Runtime patches that must load before a Pixi renderer is created:
 * - unsafe-eval: Pixi's shader/uniform codegen uses `new Function`, which the
 *   app's CSP (script-src 'self') forbids; this module swaps in eval-free
 *   implementations.
 * - WebWorkerAdapter: inside the export worker there is no `document`; Pixi
 *   needs its worker DOM adapter to create contexts/canvases there.
 */
import 'pixi.js/unsafe-eval';
import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';

if (typeof document === 'undefined') {
  DOMAdapter.set(WebWorkerAdapter);
}
