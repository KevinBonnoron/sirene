import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  name: string | null;
  onChange: (next: string | null) => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}

export function SessionTitle({ name, onChange, editing, onEditingChange }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(name ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(name ?? '');
  }, [name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function commit() {
    const trimmed = draft.trim();
    onChange(trimmed.length > 0 ? trimmed : null);
    onEditingChange(false);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          } else if (e.key === 'Escape') {
            setDraft(name ?? '');
            onEditingChange(false);
          }
        }}
        placeholder={t('studio.untitledSession')}
        className="mb-6 w-full bg-transparent font-serif text-2xl tracking-tight italic outline-none placeholder:text-dim sm:text-3xl"
      />
    );
  }

  return (
    <h1 className="mb-6 font-serif text-2xl tracking-tight sm:text-3xl">
      <button type="button" onClick={() => onEditingChange(true)} className="text-left transition-colors hover:text-accent-amber">
        {name ?? <span className="italic text-dim">{t('studio.untitledSession')}</span>}
      </button>
    </h1>
  );
}
