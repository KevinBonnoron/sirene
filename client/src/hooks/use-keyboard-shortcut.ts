import { useEffect, useRef } from 'react';

interface ShortcutOptions {
  /** Lower-case key, e.g. 'n', 'k'. Matches `event.key.toLowerCase()`. */
  key: string;
  /** True when ⌘/Ctrl must be pressed. Defaults to true since most app shortcuts need it. */
  meta?: boolean;
  /** Skip the handler when focus is in a text input — avoids hijacking the user's typing. */
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

/**
 * Register a global keyboard shortcut. The handler is held in a ref so callers don't need to
 * memoise it — the listener attaches once per (enabled, key, meta, ignoreInTextInputs) tuple.
 * Pass `enabled=false` to skip the listener entirely (e.g. while a modal already owns the kbd).
 */
export function useKeyboardShortcut(handler: (event: KeyboardEvent) => void, { key, meta = true, ignoreInTextInputs = true }: ShortcutOptions, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== key) {
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
  }, [enabled, key, meta, ignoreInTextInputs]);
}
