import { useEffect, useRef } from 'react';

interface ShortcutOptions {
  key: string;
  meta?: boolean;
  ignoreInTextInputs?: boolean;
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

export function useKeyboardShortcut(handler: (event: KeyboardEvent) => void, { key, meta = true, ignoreInTextInputs = true }: ShortcutOptions, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const normalizedKey = key.toLowerCase();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== normalizedKey) {
        return;
      }
      if (meta && !(e.metaKey || e.ctrlKey)) {
        return;
      }
      if (!meta && (e.metaKey || e.ctrlKey)) {
        return;
      }
      if (ignoreInTextInputs && isTextInputTarget(e.target)) {
        return;
      }
      e.preventDefault();
      handlerRef.current(e);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, normalizedKey, meta, ignoreInTextInputs]);
}
