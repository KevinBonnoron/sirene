import { describe, expect, test } from 'bun:test';
import { acceptsModel } from './fleet';

const server = (syncPolicy: 'all' | 'cpu' | 'gpu' | 'none', device: string, vram = 0) => ({ syncPolicy, lastHealth: { at: '', status: 'online' as const, error: '', device, vram } });

describe('acceptsModel', () => {
  test('a GPU-only model never lands on a CPU worker', () => {
    expect(acceptsModel(server('all', 'cpu'), { hardware: 'gpu' })).toBe(false);
  });
  test('all takes anything the hardware runs', () => {
    expect(acceptsModel(server('all', 'cpu'), { hardware: 'cpu' })).toBe(true);
    expect(acceptsModel(server('all', 'cuda'), { hardware: 'gpu' })).toBe(true);
  });
  test('cpu and gpu policies match the model hardware flag', () => {
    expect(acceptsModel(server('cpu', 'cuda'), { hardware: 'gpu' })).toBe(false);
    expect(acceptsModel(server('gpu', 'cuda'), { hardware: 'cpu' })).toBe(false);
    expect(acceptsModel(server('gpu', 'cuda'), { hardware: 'gpu' })).toBe(true);
  });
  test('none refuses everything', () => {
    expect(acceptsModel(server('none', 'cuda'), { hardware: 'cpu' })).toBe(false);
  });
  test('the VRAM floor applies only when both sides are known', () => {
    expect(acceptsModel(server('all', 'cuda', 8 * 1024 ** 3), { hardware: 'gpu', minVram: 16 })).toBe(false);
    expect(acceptsModel(server('all', 'cuda', 24 * 1024 ** 3), { hardware: 'gpu', minVram: 16 })).toBe(true);
    expect(acceptsModel(server('all', 'cuda'), { hardware: 'gpu', minVram: 16 })).toBe(true);
  });
});
