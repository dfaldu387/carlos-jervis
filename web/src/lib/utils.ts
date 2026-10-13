import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().slice(11, 16);
}

export function formatMinutes(minutes?: number | null): string {
  const value = Number(minutes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 min';
  const h = Math.floor(value / 60);
  const m = Math.round(value % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function titleCase(value?: string | null): string {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

export function initialsOf(name?: string | null): string {
  return (name ?? 'J')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
