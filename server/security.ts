export const MAX_TEXT = 2000;
export const MAX_AUDIO_BASE64 = 60000;
const DEFAULT_ALLOWED = ['http://localhost:3000', 'http://localhost:5173'];

export function allowedOrigin(origin: unknown, host: unknown, extra = ''): boolean {
  if (typeof origin !== 'string' || !origin || typeof host !== 'string') return false;
  try {
    const u = new URL(origin);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return false;
    const allowlist = [...DEFAULT_ALLOWED, ...extra.split(',').map(v => v.trim()).filter(Boolean)];
    return u.origin === `${u.protocol}//${host}` || allowlist.includes(u.origin);
  } catch { return false; }
}

export function validateMessage(value: unknown): { type: 'audio' | 'text' | 'ping'; audio?: string; text?: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.type === 'ping') return { type: 'ping' };
  if (input.type === 'text' && typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= MAX_TEXT) {
    return { type: 'text', text: input.text.trim() };
  }
  if (input.type === 'audio' && typeof input.audio === 'string' && input.audio.length > 0 && input.audio.length <= MAX_AUDIO_BASE64 && input.audio.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.audio)) {
    return { type: 'audio', audio: input.audio };
  }
  return null;
}

export function windowLimit(max: number, period: number, now: () => number = Date.now) {
  const tracked = new Map<string, { until: number; hits: number }>();
  return (id: string): boolean => {
    const t = now();
    const old = tracked.get(id);
    if (old && old.until > t) {
      if (old.hits >= max) return false;
      old.hits++;
      return true;
    }
    if (tracked.size > 2000) {
      for (const [k, v] of tracked) if (v.until <= t) tracked.delete(k);
      if (tracked.size > 2000) tracked.clear();
    }
    tracked.set(id, { until: t + period, hits: 1 });
    return true;
  };
}
