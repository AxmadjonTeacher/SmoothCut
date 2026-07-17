import { open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, dialog, BrowserWindow } from 'electron';
import type { ExportSettings } from '@smoothcut/shared';

interface ExportJob {
  fh: FileHandle;
  partPath: string;
  destination: string;
  /** Current file extent; appends land here, positional writes may rewrite inside it. */
  size: number;
}

/**
 * Renderer-driven MP4 export sink: the renderer encodes and streams chunks
 * over IPC; main owns the file handle so finalize/abort are atomic
 * (.part → rename).
 */
export class ExportFileSink {
  private readonly jobs = new Map<string, ExportJob>();

  async pickDestination(defaultName: string, defaultDirectory?: string): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const options = {
      title: 'Export video',
      defaultPath: join(defaultDirectory ?? app.getPath('downloads'), basename(defaultName)),
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  /** Folder picker for the default export directory; null when cancelled. */
  async pickDirectory(currentDirectory?: string): Promise<string | null> {
    // Dev harness: dialogs can't be driven headlessly — return the fake pick.
    const devFake = process.env.SMOOTHCUT_DEV_FAKE_PICK_DIR;
    if (devFake) return devFake;
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    const options: Electron.OpenDialogOptions = {
      title: 'Choose export folder',
      ...(currentDirectory !== undefined ? { defaultPath: currentDirectory } : {}),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async begin(_projectId: string, settings: ExportSettings): Promise<{ exportId: string }> {
    if (!settings.destination || dirname(settings.destination) === settings.destination) {
      throw new Error('export-destination-invalid');
    }
    const exportId = randomUUID();
    const partPath = `${settings.destination}.part`;
    const fh = await open(partPath, 'w');
    this.jobs.set(exportId, { fh, partPath, destination: settings.destination, size: 0 });
    return { exportId };
  }

  async writeChunk(exportId: string, chunk: ArrayBuffer, position: number | null): Promise<void> {
    const job = this.job(exportId);
    const buf = Buffer.isBuffer(chunk)
      ? chunk
      : ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        : Buffer.from(chunk);
    const at = position ?? job.size;
    await job.fh.write(buf, 0, buf.length, at);
    job.size = Math.max(job.size, at + buf.length);
  }

  async finalize(exportId: string): Promise<{ sizeBytes: number }> {
    const job = this.job(exportId);
    this.jobs.delete(exportId);
    await job.fh.close();
    await rename(job.partPath, job.destination);
    return { sizeBytes: job.size };
  }

  async abort(exportId: string): Promise<void> {
    const job = this.jobs.get(exportId);
    if (!job) return;
    this.jobs.delete(exportId);
    await job.fh.close().catch(() => {});
    await unlink(job.partPath).catch(() => {});
  }

  private job(exportId: string): ExportJob {
    const job = this.jobs.get(exportId);
    if (!job) throw new Error(`unknown export: ${exportId}`);
    return job;
  }
}
