import { useEffect, useRef } from 'react';

const surfaces = new Set();
const isolation = new WeakMap();
let originalOverflow;

// Shared by the form and location sheet so both isolate and restore the background.
export function useModalSurface(layerRef, enabled, onClose) {
  const close = useRef(onClose);
  const opener = useRef(null);
  const wasEnabled = useRef(false);
  if (enabled && !wasEnabled.current) opener.current = document.activeElement;
  wasEnabled.current = enabled;
  close.current = onClose;
  useEffect(() => {
    const layer = layerRef.current;
    if (!enabled || !layer) return undefined;
    const previous = opener.current;
    if (!surfaces.size) originalOverflow = document.body.style.overflow;
    surfaces.add(layer);
    const isolated = [];
    for (let node = layer; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node) {
          const state = isolation.get(sibling) || { count: 0, original: sibling.inert };
          state.count += 1;
          isolation.set(sibling, state);
          isolated.push(sibling);
          sibling.inert = true;
        }
      }
    }
    document.body.style.overflow = 'hidden';
    const focusable = () => [...layer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((node) => !node.closest('[inert]') && node.getClientRects().length);
    focusable()[0]?.focus();
    function onKey(event) {
      if ([...surfaces].at(-1) !== layer) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      isolated.forEach((node) => {
        const state = isolation.get(node);
        if (--state.count === 0) { node.inert = state.original; isolation.delete(node); }
      });
      surfaces.delete(layer);
      if (!surfaces.size) document.body.style.overflow = originalOverflow;
      queueMicrotask(() => {
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus?.({ preventScroll: true });
      });
    };
  }, [layerRef, enabled]);
}
