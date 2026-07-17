import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Opaque views declare themselves before the first render; every other view
// runs in a transparent window and must never paint a background (see
// styles.css). The editor/capture windows are regular opaque windows.
const view = new URLSearchParams(window.location.search).get('view');
if (view === 'editor' || view === 'capture') {
  document.body.classList.add('view-opaque');
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
