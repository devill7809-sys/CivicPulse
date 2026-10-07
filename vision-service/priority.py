import math


def calculate_priority(severity_score, duplicate_count, evidence_match=None):
    if not isinstance(severity_score, (int, float)) or isinstance(severity_score, bool) or not math.isfinite(severity_score):
        severity_score = 0.4
    severity_score = min(1.0, max(0.0, float(severity_score)))

    if not isinstance(duplicate_count, int) or isinstance(duplicate_count, bool) or duplicate_count < 0:
        duplicate_count = 0
    duplicate_factor = min(1.0, duplicate_count / 3)

    match_value = evidence_match.get('match') if isinstance(evidence_match, dict) else None
    match_factor = 1.0 if not isinstance(match_value, bool) or match_value else 0.0
    score = 0.55 * severity_score + 0.25 * duplicate_factor + 0.20 * match_factor
    label = 'HIGH' if score >= 0.7 else 'MEDIUM' if score >= 0.45 else 'LOW'
    return {'label':label, 'score':round(score, 3)}
