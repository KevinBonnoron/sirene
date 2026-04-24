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
  /** Toggle a speed mark on the current selection. Reapplying the same rate clears it. */
  toggleSpeed: (rate: number) => void;
  /** Toggle a tone mark on the current selection. */
  toggleTone: (tone: string) => void;
  /** Insert an inline effect node (pause / sound effect) at the current cursor. */
  insertEffect: (effect: string, label?: string) => void;
}

interface Props {
  ref?: React.Ref<TakeEditorHandle>;
  initialContent?: JSONContent;
  placeholder?: string;
  editable?: boolean;
  onChange?: (editor: Editor) => void;
  onSubmit?: () => void;
  className?: string;
}

// Editorial body styling per design handoff (`d6-ed`): Fraunces 19px / line-height 1.75.
const EDITOR_CLASSES = '[&_.tiptap]:font-serif [&_.tiptap]:text-[19px] [&_.tiptap]:leading-[1.75] [&_.tiptap]:font-normal [&_.tiptap]:outline-none [&_.tiptap_p]:my-0';

export function TakeEditor({ ref, initialContent, placeholder, editable = true, onChange, onSubmit, className }: Props) {
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

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
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      SpeedMark,
      ToneMark,
      EffectNode,
    ],
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    onTransaction: ({ editor }) => onChange?.(editor),
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
