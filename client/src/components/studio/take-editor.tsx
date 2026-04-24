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

const EDITOR_CLASSES = '[&_.tiptap]:min-h-[72px] [&_.tiptap]:text-base [&_.tiptap]:leading-relaxed [&_.tiptap]:outline-none [&_.tiptap_p]:my-0';

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
    }),
    [editor],
  );

  return <EditorContent editor={editor} className={`${EDITOR_CLASSES} ${className ?? ''}`} />;
}
