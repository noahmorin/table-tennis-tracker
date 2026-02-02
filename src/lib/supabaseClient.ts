import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase env vars missing. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

const REQUEST_TIMEOUT_MS = 10000;
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_MAX_DELAY_MS = 2500;
const RETRY_JITTER_RATIO = 0.2;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const jitterDelay = (ms: number) => {
  const variance = ms * RETRY_JITTER_RATIO;
  const offset = (Math.random() * 2 - 1) * variance;
  return Math.max(0, Math.round(ms + offset));
};

const isRetryableMethod = (method: string) => method === 'GET' || method === 'HEAD';

const isRetryableError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const name = (error as { name?: string }).name ?? '';
  return name === 'AbortError' || error instanceof TypeError;
};

const buildFriendlyError = (timedOut: boolean) => {
  if (timedOut) {
    return new Error('The server is taking too long to respond. Please try again.');
  }
  return new Error('Unable to reach the server. Please check your connection and try again.');
};

const buildRetryStatusError = (status: number) => {
  if (status === 429) {
    return new Error('The server is busy. Please wait a moment and try again.');
  }
  return new Error('The server is temporarily unavailable. Please try again.');
};

const fetchWithTimeoutAndRetry: typeof fetch = async (input, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase();
  const allowRetry = isRetryableMethod(method);
  const maxAttempts = allowRetry ? RETRY_MAX_ATTEMPTS : 1;

  let lastTimedOut = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timeoutFired = false;
    const timeoutId = setTimeout(() => {
      timeoutFired = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let abortListener: (() => void) | null = null;
    if (init.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        abortListener = () => controller.abort();
        init.signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });

      if (allowRetry && RETRYABLE_STATUS.has(response.status)) {
        if (attempt < maxAttempts) {
          const backoff = Math.min(
            RETRY_MAX_DELAY_MS,
            RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
          );
          await delay(jitterDelay(backoff));
          continue;
        }
        throw buildRetryStatusError(response.status);
      }

      return response;
    } catch (error) {
      lastTimedOut = timeoutFired;
      if (!allowRetry || attempt >= maxAttempts || !isRetryableError(error)) {
        throw buildFriendlyError(timeoutFired);
      }

      const backoff = Math.min(
        RETRY_MAX_DELAY_MS,
        RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
      );
      await delay(jitterDelay(backoff));
    } finally {
      clearTimeout(timeoutId);
      if (abortListener && init.signal) {
        init.signal.removeEventListener('abort', abortListener);
      }
    }
  }

  throw buildFriendlyError(lastTimedOut);
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: fetchWithTimeoutAndRetry
  },
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true
  }
});
