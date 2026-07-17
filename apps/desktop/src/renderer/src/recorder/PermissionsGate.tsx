/** macOS permissions checklist shown instead of the recorder until granted. */
import type { PermissionKind, PermissionsStatus } from '@smoothcut/shared';

interface GateItem {
  kind: PermissionKind;
  title: string;
  description: string;
  granted: boolean;
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3 7.5 6 10.5 11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PermissionsGate({ status }: { status: PermissionsStatus }) {
  const items: GateItem[] = [
    {
      kind: 'screen',
      title: 'Screen Recording',
      description:
        'Lets SmoothCut capture your display. macOS only applies this permission after the app is relaunched.',
      granted: status.screen === 'granted',
    },
    {
      kind: 'accessibility',
      title: 'Accessibility',
      description:
        'Lets SmoothCut see mouse movement and clicks while recording — that data drives auto-zoom and the smooth cursor.',
      granted: status.accessibility,
    },
  ];

  const request = (kind: PermissionKind) => {
    void window.smoothcut.invoke('permissions:request', kind);
  };
  const openSettings = (kind: PermissionKind) => {
    void window.smoothcut.invoke('permissions:openSettings', kind);
  };

  return (
    <div className="recorder gate">
      <header className="rec-header">
        <span className="logo-dot" />
        <span className="app-name">SmoothCut</span>
      </header>
      <div className="gate-body">
        <div>
          <h1 className="gate-title">One-time setup</h1>
          <p className="gate-sub">
            SmoothCut needs two macOS permissions before it can record. This list updates
            automatically as you grant them.
          </p>
        </div>
        {items.map((item) => (
          <div key={item.kind} className={item.granted ? 'gate-row granted' : 'gate-row'}>
            <div className="gate-row-head">
              <span className={item.granted ? 'gate-check ok' : 'gate-check'}>
                {item.granted ? <CheckIcon /> : null}
              </span>
              <span>{item.title}</span>
              {item.granted ? <span className="gate-tag">Granted</span> : null}
            </div>
            <p className="gate-desc">{item.description}</p>
            {!item.granted ? (
              <div className="gate-actions">
                <button type="button" className="primary" onClick={() => request(item.kind)}>
                  Request
                </button>
                <button type="button" onClick={() => openSettings(item.kind)}>
                  Open Settings
                </button>
              </div>
            ) : null}
          </div>
        ))}
        <p className="gate-note">
          Tip: after granting Screen Recording, quit and reopen SmoothCut — macOS applies that
          grant on the next launch.
        </p>
      </div>
    </div>
  );
}
