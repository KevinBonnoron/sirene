import { isSectionActive } from './nav-active';
import { describe, expect, test } from 'bun:test';

describe('nav active', () => {
  test('a section owns its detail pages', () => {
    expect(isSectionActive('/admin/models/piper', '/admin/models')).toBe(true);
    expect(isSectionActive('/admin/inference-servers/abc', '/admin/inference-servers')).toBe(true);
    expect(isSectionActive('/admin/models', '/admin/models')).toBe(true);
  });

  test('the studio at the root does not own every page', () => {
    expect(isSectionActive('/voices', '/')).toBe(false);
    expect(isSectionActive('/', '/')).toBe(true);
  });

  test('a shared prefix is not a section', () => {
    expect(isSectionActive('/admin/models-archive', '/admin/models')).toBe(false);
    expect(isSectionActive('/voices', '/voice')).toBe(false);
  });
});
