import type { Editor, JSONContent } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useImperativeHandle, useRef } from 'react';
import { EffectNode, SpeedMark, ToneMark } from '@/components/generation/ssml-mark';

export interface TakeEditorHandle {
  focus: () => void;
  clear: () => void;
  getJSON: () => JSONContent;
  toggleSpeed: (rate: number) => void;
  toggleTone: (tone: string) => void;
  insertEffect: (effect: string, label?: string) => void;
}

export interface ActiveMarks {
  slow: boolean;
  fast: boolean;
  emphasis: boolean;
}

interface Props {
  ref?: React.Ref<TakeEditorHandle>;
  initialContent?: JSONContent;
  placeholder?: string;
  editable?: boolean;
  onChange?: (editor: Editor) => void;
  onActiveChange?: (active: ActiveMarks) => void;
  onSubmit?: () => void;
  className?: string;
}

const EDITOR_CLASSES = '[&_.tiptap]:font-serif [&_.tiptap]:text-[19px] [&_.tiptap]:leading-[1.75] [&_.tiptap]:font-normal [&_.tiptap]:outline-none [&_.tiptap_p]:my-0';

export function TakeEditor({ ref, initialContent, placeholder, editable = true, onChange, onActiveChange, onSubmit, className }: Props) {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;
  const activeChangeRef = useRef(onActiveChange);
  activeChangeRef.current = onActiveChange;
  // Placeholder is configured once at editor mount, but the prop can change at runtime
  // (e.g. on language switch). Read it from a ref via the function form so the extension
  // always sees the latest value, then force a redraw when the prop changes.
  const placeholderRef = useRef(placeholder ?? '');
  placeholderRef.current = placeholder ?? '';

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        heading: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Placeholder.configure({ placeholder: () => placeholderRef.current }),
      SpeedMark,
      ToneMark,
      EffectNode,
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onTransaction: ({ editor }) => {
      onChange?.(editor);
      activeChangeRef.current?.({
        slow: editor.isActive('speedMark', { rate: 0.75 }),
        fast: editor.isActive('speedMark', { rate: 1.25 }),
        emphasis: editor.isActive('toneMark', { tone: 'emphasis' }),
      });
    },
    editorProps: {
      attributes: { class: 'outline-none font-serif' },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submitRef.current?.();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Force a no-op transaction so the Placeholder extension re-runs its function and picks up
  // the new value when the prop changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placeholder isn't read inside but its change is what we want to react to
  useEffect(() => {
    if (!editor) {
      return;
    }
    editor.view.dispatch(editor.state.tr);
  }, [editor, placeholder]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus(),
      clear: () => editor?.commands.clearContent(),
      getJSON: () => editor?.getJSON() ?? { type: 'doc', content: [] },
      toggleSpeed: (rate: number) => {
        if (!editor) {
          return;
        }
        if (editor.isActive('speedMark', { rate })) {
          editor.chain().focus().unsetMark('speedMark').run();
        } else {
          editor.chain().focus().setMark('speedMark', { rate }).run();
        }
      },
      toggleTone: (tone: string) => {
        if (!editor) {
          return;
        }
        if (editor.isActive('toneMark', { tone })) {
          editor.chain().focus().unsetMark('toneMark').run();
        } else {
          editor.chain().focus().setMark('toneMark', { tone }).run();
        }
      },
      insertEffect: (effect: string, label?: string) => {
        editor
          ?.chain()
          .focus()
          .insertContent({ type: 'effectNode', attrs: { effect, label: label ?? effect } })
          .run();
      },
    }),
    [editor],
  );

  return <EditorContent editor={editor} className={`${EDITOR_CLASSES} ${className ?? ''}`} />;
}
