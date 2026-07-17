/**
 * Floating webcam bubble (?view=bubble&deviceId=...): a frameless,
 * always-on-top 240px circle showing the live camera while recording. It
 * opens its own getUserMedia stream (same deviceId as the capture window's
 * recorder) and is draggable via -webkit-app-region.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

const wrapStyle: CSSProperties = {
  width: '100vw',
  height: '100vh',
  borderRadius: '50%',
  overflow: 'hidden',
  background: '#101014',
  boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.18)',
  // Frameless window: the whole bubble is the drag handle.
  ['WebkitAppRegion' as never]: 'drag',
};

const videoStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)', // mirror, like every webcam preview
};

export default function BubbleRoot() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The bubble window is transparent; the page must be too.
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';

    const deviceId = new URLSearchParams(window.location.search).get('deviceId') ?? '';
    let stream: MediaStream | null = null;
    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({
        video: deviceId === '' ? true : { deviceId: { exact: deviceId } },
      })
      .then((media) => {
        if (cancelled) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          void video.play().catch(() => setFailed(true));
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (stream) for (const track of stream.getTracks()) track.stop();
    };
  }, []);

  return (
    <div style={wrapStyle}>
      {failed ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9a9aa5',
            fontSize: 12,
          }}
        >
          No camera
        </div>
      ) : (
        <video ref={videoRef} style={videoStyle} muted playsInline />
      )}
    </div>
  );
}
