import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { generateAudio } from '../lib/inference-client';
import { NoInferenceServerError, pickServerUrl } from '../lib/inference-router';
import type { AuthEnv } from '../middleware';
import { voiceRepository, voiceSampleRepository } from '../repositories';
import { modelService } from '../services';

const previewSchema = z.object({
  modelId: z.string().min(1),
  text: z.string().min(1),
  instructText: z.string().min(1),
  gender: z.enum(['male', 'female']).default('male'),
  language: z.string().default('en'),
});

export const voiceDesignerRoutes = new Hono<AuthEnv>()
  .post('/preview', zValidator('json', previewSchema), async (c) => {
    const { modelId, text, instructText, gender, language } = c.req.valid('json');

    const fullCatalog = await modelService.getFullCatalog();
    const catalog = fullCatalog.find((m) => m.id === modelId);
    if (!catalog) {
      return c.json({ message: `Model "${modelId}" not found` }, 404);
    }
    if (!(await modelService.isModelInstalled(catalog))) {
      return c.json({ message: `Model "${catalog.name}" is not installed` }, 400);
    }

    const modelPath = catalog.id;

    try {
      const baseUrl = await pickServerUrl();
      const audioBuffer = await generateAudio(baseUrl, {
        backend: catalog.backend,
        text,
        modelPath,
        instructText,
        instructGender: gender,
        language,
      });
      return new Response(audioBuffer, {
        headers: { 'Content-Type': 'audio/wav' },
      });
    } catch (e) {
      if (e instanceof NoInferenceServerError) {
        return c.json({ message: e.message }, 503);
      }
      return c.json({ message: e instanceof Error ? e.message : 'Voice design failed' }, 500);
    }
  })

  .post('/save', async (c) => {
    const formData = await c.req.formData();
    const name = formData.get('name') as string;
    const description = (formData.get('description') as string) || '';
    const language = (formData.get('language') as string) || 'en';
    const model = (formData.get('model') as string) || '';
    const audioFile = formData.get('audio') as File | null;
    const transcript = (formData.get('transcript') as string) || '';

    if (!name || !audioFile) {
      return c.json({ message: 'name and audio are required' }, 400);
    }

    const userId = c.get('userId') as string;
    const voice = await voiceRepository.create({ name, description, language, model, options: {}, user: userId, public: false, tags: [] });

    const sampleForm = new FormData();
    sampleForm.append('voice', voice.id);
    sampleForm.append('audio', audioFile);
    sampleForm.append('transcript', transcript);
    sampleForm.append('duration', '0');
    sampleForm.append('order', '0');
    sampleForm.append('enabled', 'true');
    await voiceSampleRepository.create(sampleForm);

    return c.json(voice, 201);
  });
