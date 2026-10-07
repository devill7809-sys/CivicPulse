import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import 'dotenv/config';

const VISION_URL = process.env.VISION_SERVICE_URL || 'http://localhost:8001';

export async function analyzeComplaint({imagePath, text, category, lat, lng, existingComplaints=[]}) {
  const form = new FormData();
  if (imagePath && fs.existsSync(imagePath)) form.append('image', fs.createReadStream(imagePath));
  form.append('text', text || '');
  form.append('category', category || '');
  form.append('lat', String(lat ?? ''));
  form.append('lng', String(lng ?? ''));
  form.append('existing_complaints', JSON.stringify(existingComplaints));
  const response = await fetch(`${VISION_URL}/analyze`, {method:'POST', body:form, headers:form.getHeaders()});
  if (!response.ok) throw new Error(`AI service returned ${response.status}`);
  return response.json();
}
