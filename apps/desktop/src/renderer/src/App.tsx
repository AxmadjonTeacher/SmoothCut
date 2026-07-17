import { lazy, Suspense } from 'react';

const RecorderRoot = lazy(() => import('./recorder/RecorderRoot'));
const EditorRoot = lazy(() => import('./editor/EditorRoot'));
const CaptureRoot = lazy(() => import('./capture/CaptureRoot'));
const BubbleRoot = lazy(() => import('./capture/BubbleRoot'));
const AreaPickerRoot = lazy(() => import('./area/AreaPickerRoot'));
const RecordingPillRoot = lazy(() => import('./recording/RecordingPillRoot'));

export function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const projectId = params.get('projectId');

  return (
    <Suspense fallback={<div className="app-loading" />}>
      {view === 'editor' && projectId ? (
        <EditorRoot projectId={projectId} />
      ) : view === 'capture' ? (
        <CaptureRoot />
      ) : view === 'bubble' ? (
        <BubbleRoot />
      ) : view === 'area-picker' ? (
        <AreaPickerRoot />
      ) : view === 'recording-pill' ? (
        <RecordingPillRoot />
      ) : (
        <RecorderRoot />
      )}
    </Suspense>
  );
}
