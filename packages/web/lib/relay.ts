import { supabase } from './supabase';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3001';

export class RelayError extends Error {
  constructor(public status: number, public body: string, public parsed: unknown) {
    super(typeof parsed === 'object' && parsed && 'error' in parsed
      ? String((parsed as { error: unknown }).error)
      : `Relay error ${status}`);
    this.name = 'RelayError';
  }
}

interface RelayOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
}

// Auth'd fetch wrapper for the relay's REST API. Pulls the current Supabase
// access token per call so a refresh doesn't leave us sending stale JWTs.
// Throws RelayError on non-2xx; caller can inspect .status and .message.
export async function relay<T = unknown>(path: string, opts: RelayOptions = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new RelayError(401, '', { error: 'Not signed in' });

  const { body, headers: extraHeaders, ...rest } = opts;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
    ...(extraHeaders ?? {}),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${RELAY_URL}${path}`, {
    ...rest,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!res.ok) throw new RelayError(res.status, text, parsed);
  return parsed as T;
}
