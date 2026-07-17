import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, shell } from 'electron';
import { projectFileSchema } from '@smoothcut/shared';
import type {
  BundleUrls,
  LoadedProject,
  ProjectFile,
  ProjectSummary,
  RecordingMeta,
} from '@smoothcut/shared';

const BUNDLE_EXT = '.smoothcut';
const AUTOSAVE_KEEP = 5;

export const REL = {
  meta: 'meta.json',
  project: 'project.json',
  autosaveDir: 'autosave',
  recordingDir: 'recording',
  screen: join('recording', 'screen.mp4'),
  events: join('recording', 'events.jsonl'),
  cursorsDir: join('recording', 'cursors'),
  camera: join('recording', 'camera.webm'),
  mic: join('recording', 'mic.webm'),
  system: join('recording', 'system.webm'),
  thumbnail: 'thumbnail.png',
} as const;

export function bundleUrl(projectId: string, relPath: string): string {
  const rel = relPath.split(/[\\/]/).map(encodeURIComponent).join('/');
  return `smoothcut://bundle/${encodeURIComponent(projectId)}/${rel}`;
}

export class ProjectStore {
  get bundlesRoot(): string {
    return join(app.getPath('videos'), 'SmoothCut');
  }

  bundleDir(projectId: string): string {
    return join(this.bundlesRoot, `${projectId}${BUNDLE_EXT}`);
  }

  /** Create the on-disk skeleton for a new recording bundle. */
  async createBundle(projectId: string): Promise<string> {
    const dir = this.bundleDir(projectId);
    await mkdir(join(dir, REL.cursorsDir), { recursive: true });
    return dir;
  }

  async list(): Promise<ProjectSummary[]> {
    let entries;
    try {
      entries = await readdir(this.bundlesRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(BUNDLE_EXT)) continue;
      const id = entry.name.slice(0, -BUNDLE_EXT.length);
      const dir = this.bundleDir(id);
      try {
        const meta = JSON.parse(await readFile(join(dir, REL.meta), 'utf8')) as RecordingMeta;
        const project = projectFileSchema.parse(
          JSON.parse(await readFile(join(dir, REL.project), 'utf8')),
        );
        summaries.push({
          id,
          name: project.name,
          createdAt: meta.createdAt,
          durationMs: meta.durationMs,
          ...(existsSync(join(dir, REL.thumbnail))
            ? { thumbnailUrl: bundleUrl(id, REL.thumbnail) }
            : {}),
        });
      } catch {
        // Half-written or foreign dir — not listable.
      }
    }
    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return summaries;
  }

  async load(projectId: string): Promise<LoadedProject> {
    const dir = this.bundleDir(projectId);
    const meta = JSON.parse(await readFile(join(dir, REL.meta), 'utf8')) as RecordingMeta;
    const project = projectFileSchema.parse(
      JSON.parse(await readFile(join(dir, REL.project), 'utf8')),
    );
    const urls: BundleUrls = {
      screen: bundleUrl(projectId, REL.screen),
      eventsJsonl: bundleUrl(projectId, REL.events),
      cursorsBase: bundleUrl(projectId, REL.cursorsDir) + '/',
      ...(existsSync(join(dir, REL.camera)) ? { camera: bundleUrl(projectId, REL.camera) } : {}),
      ...(existsSync(join(dir, REL.mic)) ? { mic: bundleUrl(projectId, REL.mic) } : {}),
      ...(existsSync(join(dir, REL.system)) ? { system: bundleUrl(projectId, REL.system) } : {}),
    };
    return { id: projectId, project, meta, urls };
  }

  async save(projectId: string, project: ProjectFile): Promise<void> {
    const parsed = projectFileSchema.parse(project);
    const dir = this.bundleDir(projectId);
    const json = JSON.stringify(parsed, null, 2);
    await this.writeAtomic(join(dir, REL.project), json);
    await this.rollAutosave(dir, json);
  }

  async writeMeta(projectId: string, meta: RecordingMeta): Promise<void> {
    await this.writeAtomic(
      join(this.bundleDir(projectId), REL.meta),
      JSON.stringify(meta, null, 2),
    );
  }

  async delete(projectId: string): Promise<void> {
    await shell.trashItem(this.bundleDir(projectId));
  }

  async deleteBundleDirHard(projectId: string): Promise<void> {
    await rm(this.bundleDir(projectId), { recursive: true, force: true });
  }

  async eventsText(projectId: string): Promise<string> {
    try {
      return await readFile(join(this.bundleDir(projectId), REL.events), 'utf8');
    } catch {
      return '';
    }
  }

  private async writeAtomic(path: string, content: string): Promise<void> {
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, path);
  }

  /** Rolling autosave/project.<n>.json, keeping the newest AUTOSAVE_KEEP. */
  private async rollAutosave(dir: string, json: string): Promise<void> {
    const autosaveDir = join(dir, REL.autosaveDir);
    await mkdir(autosaveDir, { recursive: true });
    const existing: number[] = [];
    for (const name of await readdir(autosaveDir)) {
      const match = /^project\.(\d+)\.json$/.exec(name);
      if (match && match[1] !== undefined) existing.push(Number(match[1]));
    }
    existing.sort((a, b) => a - b);
    const next = (existing[existing.length - 1] ?? 0) + 1;
    await writeFile(join(autosaveDir, `project.${next}.json`), json, 'utf8');
    const stale = existing.slice(0, Math.max(0, existing.length + 1 - AUTOSAVE_KEEP));
    for (const n of stale) {
      await unlink(join(autosaveDir, `project.${n}.json`)).catch(() => {});
    }
  }
}
