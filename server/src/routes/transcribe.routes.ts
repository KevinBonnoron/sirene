import { Hono } from 'hono';
import { NoInferenceServerError, pickTarget } from '../lib/inference-router';
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
    if (err instanceof NoInferenceServerError) {
      return c.json({ error: err.message }, 503);
    }
    throw err;
  }

  const inferenceForm = new FormData();
  inferenceForm.append('audio', audioFile);
  inferenceForm.append('model_path', modelPath);

  // Whisper transcription latency is bounded by audio length; capping at 5 minutes
  // covers very long uploads while still preventing unbounded resource pile-up if the
  // worker accepts the connection but stalls.
  const TRANSCRIBE_TIMEOUT_MS = 300_000;

  let response: Response;
  try {
    response = await fetch(`${target.url}/transcribe`, {
      method: 'POST',
      headers: target.authToken ? { Authorization: `Bearer ${target.authToken}` } : {},
      body: inferenceForm,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (err) {
    // fetch() rejects on connection / DNS / TLS / timeout. With multi-server routing
    // pickTarget() can hand back an `unknown` fallback that turns out to be unreachable,
    // so this needs to surface as a bad-gateway (504 for the timeout case).
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const message = err instanceof Error ? err.message : 'inference unreachable';
    return c.json({ error: `Transcription failed: ${message}` }, isTimeout ? 504 : 502);
  }

  if (!response.ok) {
    const body = await response.text();
    return c.json({ error: `Transcription failed: ${body}` }, 502);
  }

  const result = (await response.json()) as { text: string; language?: string };
  return c.json(result);
});
