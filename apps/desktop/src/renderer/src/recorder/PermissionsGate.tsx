/**
 * Compact macOS permissions gate rendered INSIDE the recorder pill until
 * Screen Recording + Accessibility are granted (the pill polls and swaps to
 * the toolbar automatically).
 */
import type { PermissionKind, PermissionsStatus } from '@smoothcut/shared';
import { WarnIcon } from './icons';

interface GateItem {
  kind: PermissionKind;
  title: string;
  granted: boolean;
}

export function PermissionsGate({ status }: { status: PermissionsStatus }) {
  const items: GateItem[] = [
    { kind: 'screen', title: 'Screen Recording', granted: status.screen === 'granted' },
    { kind: 'accessibility', title: 'Accessibility', granted: status.accessibility },
  ];
  const missing = items.filter((i) => !i.granted);
  const next = missing[0];
  if (!next) return null;

  // macOS only shows its own consent dialog the FIRST time a permission is
  // requested for a given app — once an entry exists (even switched off),
  // requesting again is a silent no-op. Firing the request AND opening the
  // right Settings pane every time means this button never dead-ends.
  const grantAccess = (kind: PermissionKind) => {
    void window.smoothcut.invoke('permissions:request', kind);
    void window.smoothcut.invoke('permissions:openSettings', kind);
  };

  return (
    <div className="pill-gate">
      <span className="pill-gate-icon">
        <WarnIcon />
      </span>
      <div className="pill-gate-text">
        <strong>{missing.map((m) => m.title).join(' + ')} needed</strong>
        <span>
          {next.kind === 'screen'
            ? 'Grant Screen Recording, then relaunch SmoothCut (macOS applies it on the next launch).'
            : 'Accessibility lets SmoothCut track clicks for auto-zoom and the smooth cursor.'}
        </span>
      </div>
      <div className="pill-gate-actions">
        <button type="button" className="primary mini" onClick={() => grantAccess(next.kind)}>
          Grant Access
        </button>
      </div>
    </div>
  );
}
