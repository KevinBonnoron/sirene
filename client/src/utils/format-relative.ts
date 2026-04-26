import type { TFunction } from 'i18next';

export function formatRelative(date: Date | string, t: TFunction, now = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) {
    return t('studio.relativeJustNow');
  }
  if (diff < 3600) {
    return t('studio.relativeMinutes', { count: Math.floor(diff / 60) });
  }
  if (diff < 86400) {
    return t('studio.relativeHours', { count: Math.floor(diff / 3600) });
  }
  const days = Math.floor(diff / 86400);
  if (days < 7) {
    return t('studio.relativeDays', { count: days });
  }
  return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
}
