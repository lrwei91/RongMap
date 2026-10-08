import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Visual viewport shrinks with the iOS keyboard; sheets keep their actions in view.
function syncVisualViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
  document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
}
syncVisualViewport();
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);
window.addEventListener('resize', syncVisualViewport);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
