const CATEGORIES = new Set(['pothole','garbage','streetlight','water leakage','drainage','damaged road','other']);
const SEVERITIES = new Set(['LOW','MEDIUM','HIGH']);
const PRIORITIES = new Set(['LOW','MEDIUM','HIGH']);
const SAFE_AI_FAILURE = Object.freeze({available:false, error:'AI analysis is temporarily unavailable.', priority:{label:'MEDIUM',score:0.5}});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateAiResponse(value) {
  if (!isRecord(value) || typeof value.available !== 'boolean') return null;
  if (value.available === false) return safeAiFailure();

  if (typeof value.model !== 'string' || value.model.length > 100) return null;
  const normalized = {available:true, model:value.model};

  if (value.classification !== null) {
    const classification = value.classification;
    if (!isRecord(classification) || !CATEGORIES.has(classification.label)
      || !isFiniteRange(classification.confidence, 0, 1)) return null;
    normalized.classification = {label:classification.label, confidence:classification.confidence};
  } else {
    normalized.classification = null;
  }

  if (!isRecord(value.nlp) || !SEVERITIES.has(value.nlp.severity)) return null;
  normalized.nlp = {severity:value.nlp.severity};

  if (value.evidence_match !== null) {
    const match = value.evidence_match;
    if (!isRecord(match) || typeof match.match !== 'boolean'
      || !CATEGORIES.has(match.predicted) || typeof match.requested !== 'string' || match.requested.length > 80) return null;
    normalized.evidence_match = {match:match.match, predicted:match.predicted, requested:match.requested};
  } else {
    normalized.evidence_match = null;
  }

  if (!Array.isArray(value.duplicates) || value.duplicates.length > 300) return null;
  normalized.duplicates = [];
  for (const duplicate of value.duplicates) {
    if (!isRecord(duplicate) || typeof duplicate.complaintId !== 'string' || duplicate.complaintId.length > 100
      || !isFiniteRange(duplicate.textSimilarity, -1, 1)
      || (duplicate.distanceMeters !== null && !isFiniteRange(duplicate.distanceMeters, 0, 100_000_000))) return null;
    normalized.duplicates.push({
      complaintId:duplicate.complaintId,
      textSimilarity:duplicate.textSimilarity,
      distanceMeters:duplicate.distanceMeters
    });
  }

  if (!isRecord(value.priority) || !PRIORITIES.has(value.priority.label)
    || !isFiniteRange(value.priority.score, 0, 1)) return null;
  normalized.priority = {label:value.priority.label, score:value.priority.score};
  return normalized;
}

export function safeAiFailure() {
  return {...SAFE_AI_FAILURE, priority:{...SAFE_AI_FAILURE.priority}};
}

export function normalizeAiResultOrFallback(value) {
  return validateAiResponse(value) || safeAiFailure();
}
