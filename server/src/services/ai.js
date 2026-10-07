import fs from 'node:fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import 'dotenv/config';
import {validateAiResponse} from './ai-response.js';
import {postVisionRequest} from './ai-request.js';

const VISION_URL = process.env.VISION_SERVICE_URL || 'http://localhost:8001';
const VISION_SERVICE_TOKEN = process.env.VISION_SERVICE_TOKEN;
export {normalizeAiResultOrFallback, safeAiFailure} from './ai-response.js';
export {VISION_REQUEST_TIMEOUT_MS} from './ai-config.js';

export async function analyzeComplaint({imagePath, text, category, lat, lng, existingComplaints=[]}) {
  if (!VISION_SERVICE_TOKEN || VISION_SERVICE_TOKEN.length < 32 || VISION_SERVICE_TOKEN.startsWith('replace-with-')) {
    throw new Error('Vision service authentication is not configured');
  }

  const form = new FormData();
  if (imagePath && fs.existsSync(imagePath)) form.append('image', fs.createReadStream(imagePath));
  form.append('text', text || '');
  form.append('category', category || '');
  form.append('lat', String(lat ?? ''));
  form.append('lng', String(lng ?? ''));
  form.append('existing_complaints', JSON.stringify(existingComplaints));

  const headers = {...form.getHeaders(), 'x-civicpulse-service-token':VISION_SERVICE_TOKEN};
  return postVisionRequest({
    url:`${VISION_URL}/analyze`,
    body:form,
    headers,
    fetchImpl:fetch,
    processResponse:async (response) => {
      if (!response.ok) throw new Error('Vision service request failed');
      const parsed = await response.json();
      const validated = validateAiResponse(parsed);
      if (!validated) throw new Error('Vision service returned an invalid response');
      return validated;
    }
  });
}
