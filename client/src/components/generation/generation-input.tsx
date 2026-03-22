import type { GenerateRequest } from '@sirene/shared';
import type { Editor } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PAUSE_PRESETS, SOUND_EFFECT_PRESETS, SPEED_PRESETS, TONE_PRESETS } from '@/constants/ssml-presets';
import { contentToSSML, getSpeedBorderColor, stripSSML } from '@/utils/ssml';
import { EffectNode, SpeedMark, ToneMark } from './ssml-mark';

interface Capabilities {
  tone: boolean;
  effects: boolean;
}

interface Props {
  voiceId: string;
  generate: (request: GenerateRequest) => Promise<Blob>;
  isGenerating: boolean;
  capabilities: Capabilities;
  voiceSelector?: React.ReactNode;
}

function getActiveSpeed(editor: Editor | null): string {
  if (!editor) {
    return '';
  }
  return SPEED_PRESETS.find((p) => editor.isActive('speedMark', { rate: p.rate }))?.key ?? '';
}

function getActiveTone(editor: Editor | null): string {
  if (!editor) {
    return '';
  }
  return TONE_PRESETS.find((p) => editor.isActive('toneMark', { tone: p.key }))?.key ?? '';
}

export function GenerationInput({ voiceId, generate, isGenerating, capabilities, voiceSelector }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [activeSpeed, setActiveSpeed] = useState('');
  const [activeTone, setActiveTone] = useState('');

  const submitRef = useRef<{ canSubmit: boolean; submit: () => void }>({ canSubmit: false, submit: () => {} });

  function syncActiveMarks(editor: Editor) {
    setActiveSpeed(getActiveSpeed(editor));
    setActiveTone(getActiveTone(editor));
  }

  const editor = useEditor({
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
      Placeholder.configure({ placeholder: t('generate.placeholder') }),
      SpeedMark,
      ToneMark,
      EffectNode,
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    onTransaction: ({ editor }) => {
      setText(contentToSSML(editor.getJSON()));
      syncActiveMarks(editor);
    },
    editorProps: {
      attributes: { class: 'outline-none' },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (submitRef.current.canSubmit) {
            submitRef.current.submit();
          }
          return true;
        }
        if (event.key === 'Home') {
          const { $anchor } = view.state.selection;
          const startPos = $anchor.start($anchor.depth);
          const resolved = view.state.doc.resolve(startPos);
          if (event.shiftKey) {
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.head, startPos)));
          } else {
            view.dispatch(view.state.tr.setSelection(TextSelection.near(resolved)));
          }
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(!isGenerating);
  }, [editor, isGenerating]);

  function applySpeed(key: string) {
    if (!editor || isGenerating) {
      return;
    }
    if (!key) {
      editor.chain().focus().unsetMark('speedMark').run();
    } else {
      const preset = SPEED_PRESETS.find((p) => p.key === key);
      if (preset) {
        editor.chain().focus().setMark('speedMark', { rate: preset.rate }).run();
      }
    }
  }

  function applyTone(key: string) {
    if (!editor || isGenerating) {
      return;
    }
    if (!key) {
      editor.chain().focus().unsetMark('toneMark').run();
    } else {
      editor.chain().focus().setMark('toneMark', { tone: key }).run();
    }
  }

  function insertEffect(key: string, label: string) {
    if (!editor || isGenerating) {
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({ type: 'effectNode', attrs: { effect: key, label } })
      .run();
  }

  const plainText = stripSSML(text);
  const canSubmit = !isGenerating && !!voiceId && !!plainText.trim();

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!voiceId || !plainText.trim()) {
      return;
    }
    try {
      await generate({ voice: voiceId, input: text, speed: 1 });
      setText('');
      editor?.commands.clearContent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('generate.failed'));
    }
  }

  submitRef.current = { canSubmit, submit: () => handleSubmit() };

  return (
    <form onSubmit={handleSubmit}>
      <Card className="gap-0 py-0 rounded-none border-none shadow-none">
        <CardContent className="p-0">
          {/* Prosody toolbar */}
          <div className="space-y-1.5 border-b px-3 py-2">
            {/* Speed + Tone */}
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup type="single" size="sm" variant="outline" value={activeSpeed} onValueChange={applySpeed} className="flex-wrap">
                {SPEED_PRESETS.map(({ key, rate, labelKey }) => (
                  <ToggleGroupItem key={key} value={key} className="gap-1 text-xs">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: getSpeedBorderColor(rate) }} />
                    {t(labelKey)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {capabilities.tone && (
                <>
                  <div className="h-4 w-px shrink-0 bg-border" />
                  <ToggleGroup type="single" size="sm" variant="outline" value={activeTone} onValueChange={applyTone} className="flex-wrap">
                    {TONE_PRESETS.map(({ key, labelKey }) => (
                      <ToggleGroupItem key={key} value={key} className="text-xs">
                        {t(labelKey)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </>
              )}
            </div>

            {/* Pauses (always available) + Sound effects (backend-dependent) */}
            <div className="flex flex-wrap items-center gap-1">
              {PAUSE_PRESETS.map(({ key, labelKey }) => (
                <Button key={key} type="button" size="sm" variant="outline" className="h-6 rounded px-1.5 font-mono text-[11px]" style={{ borderColor: 'oklch(0.5 0.0 0 / 0.35)' }} onClick={() => insertEffect(key, t(labelKey))}>
                  [{t(labelKey)}]
                </Button>
              ))}
              {capabilities.effects &&
                SOUND_EFFECT_PRESETS.map(({ key, labelKey }) => (
                  <Button key={key} type="button" size="sm" variant="outline" className="h-6 rounded px-1.5 font-mono text-[11px]" style={{ borderColor: 'oklch(0.5 0.0 0 / 0.35)' }} onClick={() => insertEffect(key, t(labelKey))}>
                    [{t(labelKey)}]
                  </Button>
                ))}
            </div>
          </div>

          {/* Voice selector */}
          {voiceSelector && <div className="px-3 pt-2">{voiceSelector}</div>}

          {/* Editor + submit button */}
          <div className="relative">
            <EditorContent editor={editor} className="[&_.tiptap]:min-h-[62px] [&_.tiptap]:py-3 [&_.tiptap]:pl-4 [&_.tiptap]:pr-12 [&_.tiptap]:text-sm [&_.tiptap_p]:my-0 [&_.tiptap_p]:leading-normal" />
            <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
              <Button type="submit" size="icon" disabled={!canSubmit} className="size-7 shrink-0 rounded-full">
                {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              </Button>
              <span className="text-muted-foreground text-[10px] tabular-nums">{plainText.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
