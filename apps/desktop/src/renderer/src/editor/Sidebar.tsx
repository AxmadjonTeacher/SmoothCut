/**
 * Right sidebar: Style | Cursor | Audio | Webcam. All edits go through
 * applyCommand / the gesture API (sliders commit one undo entry on release).
 * Spring tuning is dev-only component state — never persisted.
 */
import { useEffect, useRef, useState } from 'react';
import { GRADIENT_PRESETS } from '@smoothcut/engine';
import type { SpringTuning } from '@smoothcut/engine';
import { CANVAS_PRESETS } from '@smoothcut/shared';
import type { CanvasPreset, ProjectFile, RecordingMeta, WebcamLayout } from '@smoothcut/shared';
import { applyCommand, beginGesture, commitGesture, updateGesture } from './store';
import { SliderRow, Segmented, ToggleRow } from './controls';
import type { SliderPhase } from './controls';
import { cssGradient } from './util';
import { WALLPAPERS } from '../wallpapers';

type Tab = 'style' | 'cursor' | 'audio' | 'webcam';

const BACKGROUND_IDS = ['aurora', 'sunset', 'ocean', 'graphite', 'peach', 'forest'] as const;
const WEBCAM_LAYOUTS: { value: WebcamLayout; title: string }[] = [
  { value: 'bubble-tl', title: 'Bubble top-left' },
  { value: 'bubble-tr', title: 'Bubble top-right' },
  { value: 'bubble-bl', title: 'Bubble bottom-left' },
  { value: 'bubble-br', title: 'Bubble bottom-right' },
  { value: 'pinned-left', title: 'Pinned left' },
  { value: 'pinned-right', title: 'Pinned right' },
];

interface SidebarProps {
  project: ProjectFile;
  meta: RecordingMeta;
  hasCamera: boolean;
  tuning: SpringTuning;
  onTuning: (tuning: SpringTuning) => void;
}

/** phase-aware command helper for slider rows. */
function slide(recipe: (d: ProjectFile, v: number) => void) {
  return (v: number, phase: SliderPhase): void => {
    const bound = (d: ProjectFile): void => recipe(d, v);
    if (phase === 'preview') updateGesture(bound);
    else commitGesture(bound);
  };
}

function ColorInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const inGesture = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Native 'change' fires when the picker closes — commit once there;
    // 'input' events during the drag stay preview-only. On macOS the color
    // panel FLOATS and may never close, so the gesture can stay open
    // indefinitely — beginGesture() on the next control protects it.
    const onChange = (): void => {
      inGesture.current = false;
      onCommit(el.value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [onCommit]);

  return (
    <input
      ref={ref}
      type="color"
      value={value}
      onChange={(e) => {
        if (!inGesture.current) {
          inGesture.current = true;
          beginGesture();
        }
        updateGesture((d) => {
          d.style.background = { kind: 'solid', value: e.target.value, blur: d.style.background.blur };
        });
      }}
    />
  );
}

export function Sidebar({ project, meta, hasCamera, tuning, onTuning }: SidebarProps) {
  const [tab, setTab] = useState<Tab>('style');
  const { style, cursor, audio } = project;
  const bg = style.background;

  const setBackground = (kind: 'gradient' | 'wallpaper', value: string): void => {
    applyCommand((d) => {
      d.style.background = { kind, value, blur: d.style.background.blur };
    });
  };

  const applyPreset = (preset: CanvasPreset): void => {
    const dims =
      preset === 'source'
        ? { width: meta.capture.widthPx, height: meta.capture.heightPx }
        : CANVAS_PRESETS[preset];
    applyCommand((d) => {
      d.style.canvas = { preset, width: dims.width, height: dims.height };
    });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        {(['style', 'cursor', 'audio', 'webcam'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'sidebar-tab active' : 'sidebar-tab'}
            onClick={() => setTab(t)}
          >
            {t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="sidebar-body">
        {tab === 'style' ? (
          <>
            <section className="sb-section">
              <h3>Canvas</h3>
              <label className="control-row">
                <span className="control-label">Aspect</span>
                <select
                  value={style.canvas.preset}
                  onChange={(e) => applyPreset(e.target.value as CanvasPreset)}
                >
                  <option value="16:9">16:9 · Landscape</option>
                  <option value="9:16">9:16 · Portrait</option>
                  <option value="1:1">1:1 · Square</option>
                  <option value="4:3">4:3 · Classic</option>
                  <option value="source">
                    Source ({meta.capture.widthPx}x{meta.capture.heightPx})
                  </option>
                </select>
              </label>
            </section>

            <section className="sb-section">
              <h3>Background</h3>
              <div className="swatch-grid">
                {BACKGROUND_IDS.map((id) => {
                  const spec = GRADIENT_PRESETS[id];
                  if (!spec) return null;
                  const active = bg.kind === 'gradient' && bg.value === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      title={`Gradient · ${id}`}
                      className={active ? 'swatch active' : 'swatch'}
                      style={{ background: cssGradient(spec) }}
                      onClick={() => setBackground('gradient', id)}
                    />
                  );
                })}
              </div>
              <div className="sb-mini-label">Wallpapers</div>
              <div className="wallpaper-grid">
                {WALLPAPERS.map((w) => {
                  const active = bg.kind === 'wallpaper' && bg.value === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      title={w.label}
                      className={active ? 'wallpaper-thumb active' : 'wallpaper-thumb'}
                      onClick={() => setBackground('wallpaper', w.id)}
                    >
                      <img src={w.url} alt={w.label} draggable={false} />
                    </button>
                  );
                })}
              </div>
              <div className="control-row">
                <span className="control-label">Solid</span>
                <ColorInput
                  value={bg.kind === 'solid' ? bg.value : '#1b1c1f'}
                  onCommit={(value) =>
                    commitGesture((d) => {
                      d.style.background = { kind: 'solid', value, blur: d.style.background.blur };
                    })
                  }
                />
                {bg.kind === 'solid' ? <span className="control-value">{bg.value}</span> : null}
              </div>
              {bg.kind === 'wallpaper' || bg.kind === 'image' ? (
                <SliderRow
                  label="Blur"
                  min={0}
                  max={100}
                  step={1}
                  value={bg.blur}
                  onValue={slide((d, v) => {
                    d.style.background.blur = v;
                  })}
                />
              ) : null}
            </section>

            <section className="sb-section">
              <h3>Screen</h3>
              <SliderRow
                label="Padding"
                min={0}
                max={0.25}
                step={0.005}
                value={style.screen.paddingPct}
                display={(v) => `${Math.round(v * 100)}%`}
                onValue={slide((d, v) => {
                  d.style.screen.paddingPct = v;
                })}
              />
              <SliderRow
                label="Radius"
                min={0}
                max={120}
                step={1}
                value={style.screen.cornerRadius}
                display={(v) => `${v}px`}
                onValue={slide((d, v) => {
                  d.style.screen.cornerRadius = v;
                })}
              />
              <SliderRow
                label="Shadow"
                min={0}
                max={1}
                step={0.01}
                value={style.screen.shadow.opacity}
                display={(v) => `${Math.round(v * 100)}%`}
                onValue={slide((d, v) => {
                  d.style.screen.shadow.opacity = v;
                })}
              />
              <SliderRow
                label="Shadow blur"
                min={0}
                max={200}
                step={1}
                value={style.screen.shadow.blurPx}
                display={(v) => `${v}px`}
                onValue={slide((d, v) => {
                  d.style.screen.shadow.blurPx = v;
                })}
              />
              <SliderRow
                label="Shadow Y"
                min={-100}
                max={100}
                step={1}
                value={style.screen.shadow.offsetY}
                display={(v) => `${v}px`}
                onValue={slide((d, v) => {
                  d.style.screen.shadow.offsetY = v;
                })}
              />
            </section>
          </>
        ) : null}

        {tab === 'cursor' ? (
          <>
            <section className="sb-section">
              <h3>Cursor</h3>
              <SliderRow
                label="Size"
                min={0.5}
                max={4}
                step={0.05}
                value={cursor.size}
                display={(v) => `${v.toFixed(2)}x`}
                onValue={slide((d, v) => {
                  d.cursor.size = v;
                })}
              />
              <SliderRow
                label="Smoothing"
                min={0}
                max={1}
                step={0.01}
                value={cursor.smoothing}
                display={(v) => `${Math.round(v * 100)}%`}
                onValue={slide((d, v) => {
                  d.cursor.smoothing = v;
                })}
              />
              <ToggleRow
                label="Click ripples"
                checked={cursor.clickRipples}
                onChange={(checked) =>
                  applyCommand((d) => {
                    d.cursor.clickRipples = checked;
                  })
                }
              />
              <ToggleRow
                label="Motion blur"
                checked={cursor.motionBlur}
                onChange={(checked) =>
                  applyCommand((d) => {
                    d.cursor.motionBlur = checked;
                  })
                }
              />
            </section>

            <details className="sb-section sb-dev">
              <summary>Tuning (dev)</summary>
              <SliderRow
                label="Tension"
                min={50}
                max={2000}
                step={10}
                value={tuning.tension}
                onValue={(v) => onTuning({ ...tuning, tension: v })}
              />
              <SliderRow
                label="Drag"
                min={100}
                max={3000}
                step={10}
                value={tuning.drag}
                onValue={(v) => onTuning({ ...tuning, drag: v })}
              />
              <SliderRow
                label="Pre-click stiffen"
                min={0}
                max={500}
                step={5}
                value={tuning.preClickStiffenMs}
                display={(v) => `${v}ms`}
                onValue={(v) => onTuning({ ...tuning, preClickStiffenMs: v })}
              />
              <SliderRow
                label="Lookahead"
                min={0}
                max={1000}
                step={10}
                value={tuning.lookaheadMs}
                display={(v) => `${v}ms`}
                onValue={(v) => onTuning({ ...tuning, lookaheadMs: v })}
              />
              <SliderRow
                label="Shake filter"
                min={0}
                max={0.02}
                step={0.0005}
                value={tuning.shakeFilterAmp}
                display={(v) => v.toFixed(4)}
                onValue={(v) => onTuning({ ...tuning, shakeFilterAmp: v })}
              />
            </details>
          </>
        ) : null}

        {tab === 'audio' ? (
          <section className="sb-section">
            <h3>Audio</h3>
            <SliderRow
              label="Mic gain"
              min={-60}
              max={12}
              step={1}
              value={audio.micGainDb}
              display={(v) => `${v > 0 ? '+' : ''}${v}dB`}
              onValue={slide((d, v) => {
                d.audio.micGainDb = v;
              })}
            />
            <SliderRow
              label="System gain"
              min={-60}
              max={12}
              step={1}
              value={audio.systemGainDb}
              display={(v) => `${v > 0 ? '+' : ''}${v}dB`}
              onValue={slide((d, v) => {
                d.audio.systemGainDb = v;
              })}
            />
            <ToggleRow
              label="Normalize loudness"
              checked={audio.normalize}
              onChange={(checked) =>
                applyCommand((d) => {
                  d.audio.normalize = checked;
                })
              }
            />
            <ToggleRow
              label="Noise removal"
              checked={audio.noiseRemoval}
              onChange={(checked) =>
                applyCommand((d) => {
                  d.audio.noiseRemoval = checked;
                })
              }
            />
            <p className="sb-note">Noise removal (RNNoise, mic only) is applied at export time.</p>
          </section>
        ) : null}

        {tab === 'webcam' ? (
          <section className="sb-section">
            <h3>Webcam</h3>
            {!hasCamera ? <p className="sb-note">No camera recorded for this project.</p> : null}
            <div className="layout-grid">
              {WEBCAM_LAYOUTS.map(({ value, title }) => (
                <button
                  key={value}
                  type="button"
                  title={title}
                  className={style.webcam.layout === value ? 'layout-cell active' : 'layout-cell'}
                  onClick={() =>
                    applyCommand((d) => {
                      d.style.webcam.layout = value;
                    })
                  }
                >
                  <span className={`layout-dot layout-${value}`} />
                </button>
              ))}
              <button
                type="button"
                title="Split view — screen left, camera right"
                className={style.webcam.layout === 'split-right' ? 'layout-cell active' : 'layout-cell'}
                onClick={() =>
                  applyCommand((d) => {
                    d.style.webcam.layout = 'split-right';
                  })
                }
              >
                <span className="layout-split-screen" />
                <span className="layout-split-cam" />
              </button>
            </div>
            <p className="sb-note">Drag the camera in the preview to place it freely.</p>
            <SliderRow
              label="Size"
              min={0.1}
              max={0.5}
              step={0.01}
              value={style.webcam.sizePct}
              display={(v) => `${Math.round(v * 100)}%`}
              onValue={slide((d, v) => {
                d.style.webcam.sizePct = v;
              })}
            />
            <div
              className={
                style.webcam.layout === 'split-right' ? 'control-row row-disabled' : 'control-row'
              }
              title={
                style.webcam.layout === 'split-right'
                  ? 'Split view always uses a rounded rectangle'
                  : undefined
              }
            >
              <span className="control-label">Shape</span>
              <Segmented
                options={[
                  { value: 'squircle', label: 'Squircle' },
                  { value: 'circle', label: 'Circle' },
                  { value: 'rect', label: 'Rectangle' },
                ]}
                value={style.webcam.cornerStyle}
                onChange={(cornerStyle) =>
                  applyCommand((d) => {
                    d.style.webcam.cornerStyle = cornerStyle;
                  })
                }
              />
            </div>
            <ToggleRow
              label="Flip camera"
              checked={style.webcam.mirror === true}
              onChange={(checked) =>
                applyCommand((d) => {
                  d.style.webcam.mirror = checked;
                })
              }
            />
            <ToggleRow
              label="Hidden"
              checked={style.webcam.hidden}
              onChange={(checked) =>
                applyCommand((d) => {
                  d.style.webcam.hidden = checked;
                })
              }
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
}
