import { AudioLines, Loader2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { transcribeClient } from '@/clients/transcribe.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { pb } from '@/lib/pocketbase';
import { Waveform } from './waveform';

export function SampleUploader({ voiceId }: { voiceId: string }) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setTranscript('');
  }

  function clearFile() {
    setFile(null);
    setTranscript('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleTranscribe() {
    if (!file) {
      return;
    }
    setTranscribing(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);
      const result = await transcribeClient.transcribe(formData);
      setTranscript(result.text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('voice.transcriptionFailed'));
    } finally {
      setTranscribing(false);
    }
  }

  async function handleUpload() {
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('transcript', transcript);
      formData.append('voice', voiceId);
      formData.append('enabled', 'true');
      formData.append('order', '0');
      await pb.collection('voice_samples').create(formData);
      clearFile();
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {file ? (
        <>
          <div className="flex items-center justify-between">
            <span className="truncate text-sm font-medium">{file.name}</span>
            <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={clearFile} type="button">
              <X className="size-3.5" />
            </Button>
          </div>

          <Waveform src={file} height={48} />

          <div className="space-y-2">
            <Label className="text-xs">{t('voice.transcript')}</Label>
            <div className="flex gap-2">
              <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={t('voice.transcriptPlaceholder')} rows={2} className="min-h-0 flex-1 text-sm" />
              <Button variant="outline" size="sm" className="shrink-0 self-end" onClick={handleTranscribe} disabled={transcribing} type="button">
                {transcribing ? <Loader2 className="size-3.5 animate-spin" /> : <AudioLines className="size-3.5" />}
                {t('voice.auto')}
              </Button>
            </div>
          </div>

          <Button onClick={handleUpload} disabled={uploading} size="sm" type="button">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t('voice.uploadSample')}
          </Button>
        </>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs">{t('voice.addSample')}</Label>
          <Input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileChange} />
        </div>
      )}
    </div>
  );
}
