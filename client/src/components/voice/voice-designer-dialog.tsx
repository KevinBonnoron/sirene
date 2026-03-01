import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { voiceDesignerClient } from '@/clients/voice-designer.client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useModels } from '@/hooks/use-models';
import { LANGUAGES } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { Waveform } from './waveform';

type Step = 1 | 2 | 3;

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation();
  const stepLabels = [t('voiceDesigner.describe'), t('voiceDesigner.preview'), t('voiceDesigner.save')];

  return (
    <div className="flex items-center justify-center">
      {stepLabels.map((label, i) => {
        const step = (i + 1) as Step;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div key={step} className="flex items-center">
            {i > 0 && <div className={cn('mx-2 h-px w-8 transition-colors', isDone ? 'bg-primary/50' : 'bg-border')} />}
            <div className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors', isActive && 'border-primary bg-primary/10 text-primary', isDone && 'border-primary/50 text-primary/70', !isActive && !isDone && 'text-muted-foreground')}>
              <span className="flex size-4 items-center justify-center rounded-full bg-current/10 text-[10px] font-medium">{isDone ? '✓' : step}</span>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DesignerState = {
  step: Step;
  instructText: string;
  gender: 'male' | 'female';
  language: string;
  instructModelId: string;
  sampleText: string;
  generating: boolean;
  audioBlob: Blob | null;
  voiceName: string;
  saving: boolean;
};

type DesignerAction =
  | { type: 'setStep'; step: Step }
  | { type: 'setInstructText'; value: string }
  | { type: 'setGender'; value: 'male' | 'female' }
  | { type: 'setLanguage'; value: string }
  | { type: 'setInstructModelId'; value: string }
  | { type: 'setSampleText'; value: string }
  | { type: 'startGenerate' }
  | { type: 'generateDone'; blob: Blob }
  | { type: 'generateFailed' }
  | { type: 'setVoiceName'; value: string }
  | { type: 'startSave' }
  | { type: 'saveDone' }
  | { type: 'reset' };

const initialState: DesignerState = {
  step: 1,
  instructText: '',
  gender: 'male',
  language: 'en',
  instructModelId: '',
  sampleText: '',
  generating: false,
  audioBlob: null,
  voiceName: '',
  saving: false,
};

function designerReducer(state: DesignerState, action: DesignerAction): DesignerState {
  switch (action.type) {
    case 'setStep':
      return { ...state, step: action.step };
    case 'setInstructText':
      return { ...state, instructText: action.value };
    case 'setGender':
      return { ...state, gender: action.value };
    case 'setLanguage':
      return { ...state, language: action.value };
    case 'setInstructModelId':
      return { ...state, instructModelId: action.value };
    case 'setSampleText':
      return { ...state, sampleText: action.value };
    case 'startGenerate':
      return { ...state, generating: true, audioBlob: null };
    case 'generateDone':
      return { ...state, generating: false, audioBlob: action.blob };
    case 'generateFailed':
      return { ...state, generating: false };
    case 'setVoiceName':
      return { ...state, voiceName: action.value };
    case 'startSave':
      return { ...state, saving: true };
    case 'saveDone':
      return { ...state, saving: false };
    case 'reset':
      return initialState;
  }
}

export function VoiceDesignerDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(designerReducer, initialState);
  const { step, instructText, gender, language, instructModelId, sampleText, generating, audioBlob, voiceName, saving } = state;

  const { catalog, installations } = useModels();

  const instructModels = useMemo(() => catalog.filter((m) => m.types.includes('design') && installations?.some((i) => i.id === m.id && i.status === 'installed')), [catalog, installations]);

  const effectiveInstructModelId = instructModelId || instructModels[0]?.id || '';

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      dispatch({ type: 'reset' });
    }
  }

  async function handleGenerate() {
    if (!effectiveInstructModelId || !sampleText.trim() || !instructText.trim()) {
      return;
    }
    dispatch({ type: 'startGenerate' });
    try {
      const blob = await voiceDesignerClient.preview({
        modelId: effectiveInstructModelId,
        text: sampleText,
        instructText,
        gender,
        language,
      });
      dispatch({ type: 'generateDone', blob });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('generate.failed'));
      dispatch({ type: 'generateFailed' });
    }
  }

  async function handleSave() {
    if (!audioBlob || !voiceName.trim()) {
      return;
    }
    dispatch({ type: 'startSave' });
    try {
      const formData = new FormData();
      formData.append('name', voiceName);
      formData.append('description', instructText);
      formData.append('language', language);
      formData.append('model', '');
      formData.append('audio', new File([audioBlob], 'voice-design.wav', { type: 'audio/wav' }));
      formData.append('transcript', sampleText);
      await voiceDesignerClient.save(formData);
      toast.success(t('voiceDesigner.created', { name: voiceName }));
      handleOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('voiceDesigner.saveFailed'));
      dispatch({ type: 'saveDone' });
    }
  }

  const canGoToStep2 = !!instructText.trim() && !!language;
  const canGenerate = !!effectiveInstructModelId && !!sampleText.trim() && !generating;
  const canGoToStep3 = !!audioBlob;
  const canSave = !!voiceName.trim() && !!audioBlob && !saving;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> {t('voiceDesigner.title')}
          </DialogTitle>
        </DialogHeader>

        <StepIndicator current={step} />

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('voiceDesigner.voiceDescription')}</Label>
                <Textarea value={instructText} onChange={(e) => dispatch({ type: 'setInstructText', value: e.target.value })} placeholder={t('voiceDesigner.descriptionPlaceholder')} rows={4} />
              </div>
              <div className="space-y-2">
                <Label>{t('voiceDesigner.gender')}</Label>
                <div className="flex gap-2">
                  {(['male', 'female'] as const).map((g) => (
                    <button key={g} type="button" onClick={() => dispatch({ type: 'setGender', value: g })} className={cn('flex-1 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent/50', gender === g && 'border-primary bg-primary/10 text-primary')}>
                      {g === 'male' ? t('voiceDesigner.male') : t('voiceDesigner.female')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('voice.language')}</Label>
                <Select value={language} onValueChange={(v) => dispatch({ type: 'setLanguage', value: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value}>
                        {lang.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {instructModels.length > 1 && (
                <div className="space-y-2">
                  <Label>{t('voice.model')}</Label>
                  <Select value={effectiveInstructModelId} onValueChange={(v) => dispatch({ type: 'setInstructModelId', value: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {instructModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('voiceDesigner.sampleText')}</Label>
                <Textarea value={sampleText} onChange={(e) => dispatch({ type: 'setSampleText', value: e.target.value })} placeholder={t('voiceDesigner.sampleTextPlaceholder')} rows={3} />
              </div>

              <Button onClick={handleGenerate} disabled={!canGenerate} className="w-full">
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> {t('voiceDesigner.generating')}
                  </>
                ) : audioBlob ? (
                  <>
                    <RefreshCw className="size-4" /> {t('voiceDesigner.regenerate')}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" /> {t('voiceDesigner.generatePreview')}
                  </>
                )}
              </Button>

              {audioBlob && (
                <div className="rounded-lg border p-3">
                  <Waveform src={audioBlob} height={40} autoPlay />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              {audioBlob && (
                <div className="rounded-lg border p-3">
                  <Waveform src={audioBlob} height={40} />
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('voiceDesigner.voiceName')}</Label>
                <Input value={voiceName} onChange={(e) => dispatch({ type: 'setVoiceName', value: e.target.value })} placeholder={t('voiceDesigner.voiceNamePlaceholder')} />
              </div>

              <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                <p>
                  <strong>{t('voiceDesigner.descriptionLabel')}</strong> {instructText}
                </p>
                <p>
                  <strong>{t('voiceDesigner.languageLabel')}</strong> {LANGUAGES.find((l) => l.value === language)?.label ?? language}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (step === 1) {
                handleOpenChange(false);
              } else {
                dispatch({ type: 'setStep', step: (step - 1) as Step });
              }
            }}
          >
            {step === 1 ? t('common.cancel') : t('common.back')}
          </Button>

          {step === 1 && (
            <Button disabled={!canGoToStep2} onClick={() => dispatch({ type: 'setStep', step: 2 })}>
              {t('common.next')}
            </Button>
          )}
          {step === 2 && (
            <Button disabled={!canGoToStep3} onClick={() => dispatch({ type: 'setStep', step: 3 })}>
              {t('common.next')}
            </Button>
          )}
          {step === 3 && (
            <Button disabled={!canSave} onClick={handleSave}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {t('common.saving')}
                </>
              ) : (
                t('voiceDesigner.saveVoice')
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
