import { Hono } from 'hono';
import { pickTarget } from '../lib/inference-router';
import { inferenceRepository } from '../repositories';
import { mapServiceError, modelService } from '../services';

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
      modelPath = model.id;
      break;
    }
  }

  if (!modelPath) {
    return c.json({ error: 'No Whisper model installed. Please install one from the Models page.' }, 400);
  }

  let target: { url: string; authToken?: string };
  try {
    target = await pickTarget({ requireModel: modelPath });
  } catch (err) {
    const { status, body } = mapServiceError(err);
    return c.json(body, status);
  }

  const inferenceForm = new FormData();
  inferenceForm.append('audio', audioFile);
  inferenceForm.append('model_path', modelPath);

  // Whisper transcription latency is bounded by audio length; capping at 5 minutes
  // covers very long uploads while still preventing unbounded resource pile-up if the
  // worker accepts the connection but stalls.
  const TRANSCRIBE_TIMEOUT_MS = 300_000;

  try {
    const result = await inferenceRepository(target).transcribe(inferenceForm, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS));
    return c.json(result);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const { status, body } = mapServiceError(err);
    return c.json(body, isTimeout ? 504 : status);
  }
});
