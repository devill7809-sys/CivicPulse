import {VISION_REQUEST_TIMEOUT_MS} from './ai-config.js';

export async function postVisionRequest({url, body, headers, fetchImpl, processResponse = async (response) => response, timeoutMs = VISION_REQUEST_TIMEOUT_MS}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method:'POST',
      body,
      headers,
      signal:controller.signal,
      size:25 * 1024 * 1024
    });
    return await processResponse(response, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
