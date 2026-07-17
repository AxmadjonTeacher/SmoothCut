/**
 * Inline 20px SVG glyphs for the recorder toolbar — no icon dependencies.
 * All icons are stroke-based (currentColor) so CSS controls their color.
 * Toggle icons accept `off` to draw a diagonal slash through the glyph.
 */
import type { ReactNode } from 'react';

interface IconProps {
  off?: boolean;
}

function Glyph({ off, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g opacity={off ? 0.55 : 1}>{children}</g>
      {off ? <path d="M3.5 16.5 16.5 3.5" strokeWidth="1.6" /> : null}
    </svg>
  );
}

export function DisplayIcon() {
  return (
    <Glyph>
      <rect x="2.5" y="3.75" width="15" height="10" rx="1.6" />
      <path d="M7.25 17h5.5M10 13.75V17" />
    </Glyph>
  );
}

export function WindowIcon() {
  return (
    <Glyph>
      <rect x="2.75" y="3.5" width="14.5" height="13" rx="1.6" />
      <path d="M2.75 7.25h14.5" />
      <circle cx="5.15" cy="5.4" r="0.25" fill="currentColor" stroke="none" />
      <circle cx="7.05" cy="5.4" r="0.25" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function AreaIcon() {
  return (
    <Glyph>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.6" strokeDasharray="2.8 2.4" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function CameraIcon({ off }: IconProps) {
  return (
    <Glyph off={off}>
      <rect x="2.25" y="5.5" width="10.5" height="9" rx="2" />
      <path d="M12.75 9.4l4.25-2.4v6l-4.25-2.4" />
    </Glyph>
  );
}

export function MicIcon({ off }: IconProps) {
  return (
    <Glyph off={off}>
      <rect x="7.75" y="2.5" width="4.5" height="8.75" rx="2.25" />
      <path d="M4.75 9.5a5.25 5.25 0 0 0 10.5 0M10 14.75v2.75" />
    </Glyph>
  );
}

export function SpeakerIcon({ off }: IconProps) {
  return (
    <Glyph off={off}>
      <path d="M3.25 7.75v4.5h2.9l3.85 3.25V4.5L6.15 7.75H3.25Z" />
      <path d="M12.6 7.6a3.6 3.6 0 0 1 0 4.8M15 5.4a6.8 6.8 0 0 1 0 9.2" />
    </Glyph>
  );
}

export function GearIcon() {
  // Teeth are a dashed outer ring (8 dashes), body a solid ring + center hole.
  return (
    <Glyph>
      <circle
        cx="10"
        cy="10"
        r="6"
        strokeWidth="2.4"
        strokeDasharray="2.36 2.35"
        strokeDashoffset="1.18"
        strokeLinecap="butt"
      />
      <circle cx="10" cy="10" r="4.4" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="1.7" />
    </Glyph>
  );
}

export function XIcon() {
  return (
    <Glyph>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </Glyph>
  );
}

export function WarnIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3 1.8 16.5h16.4L10 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.9" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Small counter-clockwise reset arrow (hotkey reset-to-default). */
export function ResetIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.75 7a5.25 5.25 0 1 0 5.25-5.25 5.69 5.69 0 0 0-3.93 1.6L1.75 4.67" />
      <path d="M1.75 1.75v2.92h2.92" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.75h5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-10c-.83 0-1.5-.67-1.5-1.5v-7.75Z" />
    </svg>
  );
}
