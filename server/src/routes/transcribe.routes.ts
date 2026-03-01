import { Hono } from 'hono';
import { config } from '../lib/config';
import { modelService } from '../services';

export const transcribeRoutes = new Hono().post('/', async (c) => {
  const formData = await c.req.formData();
  const audioFile = formData.get('audio') as File | null;

  if (!audioFile) {
    return c.json({ error: 'audio file is required' }, 400);
  }

  // Resolve the best installed Whisper model (catalog order: smallest → largest)
  const catalog = await modelService.getFullCatalog();
  const whisperModels = catalog.filter((m) => m.backend === 'whisper');
  let modelPath: string | null = null;
  for (const model of whisperModels) {
    if (await modelService.isModelInstalled(model)) {
      modelPath = `${config.modelsPath}/${model.id}`;
      break;
    }
  }

  if (!modelPath) {
    return c.json({ error: 'No Whisper model installed. Please install one from the Models page.' }, 400);
  }

  const inferenceForm = new FormData();
  inferenceForm.append('audio', audioFile);
  inferenceForm.append('model_path', modelPath);

  const response = await fetch(`${config.inferenceUrl}/transcribe`, {
    method: 'POST',
    body: inferenceForm,
  });

  if (!response.ok) {
    const body = await response.text();
    return c.json({ error: `Transcription failed: ${body}` }, 502);
  }

  const result = (await response.json()) as { text: string; language?: string };
  return c.json(result);
});
