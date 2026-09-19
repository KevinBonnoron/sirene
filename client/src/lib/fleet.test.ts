import { acceptsModel } from './fleet';
import { describe, expect, test } from 'bun:test';

const server = (syncPolicy: 'all' | 'cpu' | 'gpu' | 'none', device: string, vram = 0, backends?: string[]) => ({ syncPolicy, lastHealth: { at: '', status: 'online' as const, error: '', device, vram, backends } });

describe('acceptsModel', () => {
  test('a worker that lists its backends must know the model backend', () => {
    expect(acceptsModel(server('all', 'cuda', 0, ['piper', 'kokoro']), { backend: 'fish_audio', hardware: 'gpu' })).toBe(false);
    expect(acceptsModel(server('all', 'cuda', 0, ['piper', 'fish_audio']), { backend: 'fish_audio', hardware: 'gpu' })).toBe(true);
    expect(acceptsModel(server('all', 'cuda'), { backend: 'fish_audio', hardware: 'gpu' })).toBe(true);
  });
  test('a GPU-only model never lands on a CPU worker', () => {
    expect(acceptsModel(server('all', 'cpu'), { backend: 'x', hardware: 'gpu' })).toBe(false);
  });
  test('all takes anything the hardware runs', () => {
    expect(acceptsModel(server('all', 'cpu'), { backend: 'x', hardware: 'cpu' })).toBe(true);
    expect(acceptsModel(server('all', 'cuda'), { backend: 'x', hardware: 'gpu' })).toBe(true);
  });
  test('cpu and gpu policies match the model hardware flag', () => {
    expect(acceptsModel(server('cpu', 'cuda'), { backend: 'x', hardware: 'gpu' })).toBe(false);
    expect(acceptsModel(server('gpu', 'cuda'), { backend: 'x', hardware: 'cpu' })).toBe(false);
    expect(acceptsModel(server('gpu', 'cuda'), { backend: 'x', hardware: 'gpu' })).toBe(true);
  });
  test('none refuses everything', () => {
    expect(acceptsModel(server('none', 'cuda'), { backend: 'x', hardware: 'cpu' })).toBe(false);
  });
  test('the VRAM floor applies only when both sides are known', () => {
    expect(acceptsModel(server('all', 'cuda', 8 * 1024 ** 3), { backend: 'x', hardware: 'gpu', minVram: 16 })).toBe(false);
    expect(acceptsModel(server('all', 'cuda', 24 * 1024 ** 3), { backend: 'x', hardware: 'gpu', minVram: 16 })).toBe(true);
    expect(acceptsModel(server('all', 'cuda'), { backend: 'x', hardware: 'gpu', minVram: 16 })).toBe(true);
  });
});
