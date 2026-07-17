/** Recent recordings section: list, open-in-editor, inline delete confirmation. */
import { useCallback, useEffect, useState } from 'react';
import type { ProjectSummary } from '@smoothcut/shared';
import { formatDuration, formatRelativeDate } from './format';

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M2.5 3.5h9M5.5 3.5V2.25h3V3.5M4 3.5l.6 8a1 1 0 0 0 1 .95h2.8a1 1 0 0 0 1-.95l.6-8M5.9 6v4M8.1 6v4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RecentList({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await window.smoothcut.invoke('project:list');
      setProjects(
        [...list].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)),
      );
    } catch {
      // main process not ready yet — the next poll will retry
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const openProject = (id: string) => {
    void window.smoothcut.invoke('project:openEditor', id);
  };

  const deleteProject = async (id: string) => {
    setDeletingId(id);
    try {
      await window.smoothcut.invoke('project:delete', id);
    } catch {
      // deletion failed — refresh below re-syncs the list either way
    }
    setDeletingId(null);
    setConfirmId(null);
    void refresh();
  };

  return (
    <section className="recent">
      <div className="recent-head">Recent recordings</div>
      <div className="recent-list">
        {projects !== null && projects.length === 0 ? (
          <div className="recent-empty">
            No recordings yet.
            <span>Hit record and your captures will show up here.</span>
          </div>
        ) : null}
        {(projects ?? []).map((p) =>
          confirmId === p.id ? (
            <div key={p.id} className="recent-row confirm">
              <span className="confirm-text">Delete “{p.name}”?</span>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="mini danger"
                  disabled={deletingId === p.id}
                  onClick={() => void deleteProject(p.id)}
                >
                  Delete
                </button>
                <button type="button" className="mini" onClick={() => setConfirmId(null)}>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <div
              key={p.id}
              className="recent-row"
              role="button"
              tabIndex={0}
              onClick={() => openProject(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openProject(p.id);
              }}
            >
              <div className="recent-info">
                <span className="recent-name">{p.name}</span>
                <span className="recent-meta">
                  {formatRelativeDate(p.createdAt)} · {formatDuration(p.durationMs)}
                </span>
              </div>
              <button
                type="button"
                className="row-trash"
                aria-label={`Delete ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmId(p.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ),
        )}
      </div>
    </section>
  );
}
