import test from 'node:test';
import assert from 'node:assert/strict';

import {normalizeAiResultOrFallback, safeAiFailure, validateAiResponse} from '../src/services/ai-response.js';
import {VISION_REQUEST_TIMEOUT_MS} from '../src/services/ai-config.js';
import {postVisionRequest} from '../src/services/ai-request.js';

function validResponse() {
  return {
    available:true,
    model:'CLIP + sentence-transformers',
    classification:{label:'pothole', confidence:0.82},
    nlp:{severity:'LOW'},
    evidence_match:{match:true, predicted:'pothole', requested:'pothole'},
    duplicates:[{complaintId:'CP-12345678', textSimilarity:0.91, distanceMeters:12.5}],
    priority:{label:'MEDIUM', score:0.55},
    unexpected:'must not persist'
  };
}

test('valid AI response is normalized to the supported schema', () => {
  const result = validateAiResponse(validResponse());
  assert.equal(result.available, true);
  assert.deepEqual(result.priority, {label:'MEDIUM', score:0.55});
  assert.equal(Object.hasOwn(result, 'unexpected'), false);
});

test('null and non-object AI responses are rejected', () => {
  assert.equal(validateAiResponse(null), null);
  assert.equal(validateAiResponse('valid-looking'), null);
  assert.equal(validateAiResponse([]), null);
});

test('malformed AI fields are rejected', () => {
  const response = validResponse();
  response.nlp = null;
  assert.equal(validateAiResponse(response), null);
});

test('confidence and priority scores must be within bounds', () => {
  const confidenceResponse = validResponse();
  confidenceResponse.classification.confidence = 1.01;
  assert.equal(validateAiResponse(confidenceResponse), null);

  const scoreResponse = validResponse();
  scoreResponse.priority.score = -0.01;
  assert.equal(validateAiResponse(scoreResponse), null);
});

test('unsupported category, severity, and priority enums are rejected', () => {
  const categoryResponse = validResponse();
  categoryResponse.classification.label = 'fire';
  assert.equal(validateAiResponse(categoryResponse), null);

  const severityResponse = validResponse();
  severityResponse.nlp.severity = 'CRITICAL';
  assert.equal(validateAiResponse(severityResponse), null);

  const priorityResponse = validResponse();
  priorityResponse.priority.label = 'URGENT';
  assert.equal(validateAiResponse(priorityResponse), null);
});

test('optional classification and evidence match may be absent for a no-image result', () => {
  const response = validResponse();
  response.classification = null;
  response.evidence_match = null;
  assert.deepEqual(validateAiResponse(response)?.priority, {label:'MEDIUM', score:0.55});
});

test('AI failure fallback does not retain internal error details', () => {
  const rawError = '/srv/models/private-key-timeout stacktrace';
  const fallback = safeAiFailure();
  assert.deepEqual(fallback, {available:false, error:'AI analysis is temporarily unavailable.', priority:{label:'MEDIUM', score:0.5}});
  assert.equal(JSON.stringify(fallback).includes(rawError), false);
});

test('complaint persistence receives only validated AI data or safe fallback', () => {
  const rawResponse = {available:false, error:'secret /srv/weights/stack trace', priority:{label:'URGENT', score:5}};
  const persistedAi = normalizeAiResultOrFallback(rawResponse);
  assert.deepEqual(persistedAi, safeAiFailure());
  assert.equal(JSON.stringify(persistedAi).includes('/srv/weights'), false);
});

test('vision timeout is explicitly bounded', () => {
  assert.equal(VISION_REQUEST_TIMEOUT_MS, 20_000);
});

test('vision request aborts when the configured timeout expires', async () => {
  let observedAbort = false;
  await assert.rejects(postVisionRequest({
    url:'http://vision.test/analyze',
    body:'request',
    headers:{},
    timeoutMs:5,
    fetchImpl:(_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(Object.assign(new Error('aborted'), {name:'AbortError'}));
      }, {once:true});
    })
  }), {name:'AbortError'});
  assert.equal(observedAbort, true);
});

test('vision timeout remains active while reading the response body', async () => {
  let observedAbort = false;
  await assert.rejects(postVisionRequest({
    url:'http://vision.test/analyze',
    body:'request',
    headers:{},
    timeoutMs:5,
    fetchImpl:async () => ({ok:true}),
    processResponse:(_response, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(Object.assign(new Error('body read aborted'), {name:'AbortError'}));
      }, {once:true});
    })
  }), {name:'AbortError'});
  assert.equal(observedAbort, true);
});
