import Store from 'electron-store';
import { DEFAULT_APP_SETTINGS } from '@smoothcut/shared';
import type { AppSettings } from '@smoothcut/shared';

export class SettingsStore {
  private store: Store<AppSettings> | undefined;

  private backing(): Store<AppSettings> {
    this.store ??= new Store<AppSettings>({
      name: 'settings',
      defaults: DEFAULT_APP_SETTINGS,
    });
    return this.store;
  }

  get(): AppSettings {
    return { ...DEFAULT_APP_SETTINGS, ...this.backing().store };
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<AppSettings>;
    const next: AppSettings = { ...this.get(), ...clean };
    this.backing().store = next;
    return next;
  }
}
