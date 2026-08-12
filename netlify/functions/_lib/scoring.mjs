// Pure scoring/ZTP calculation functions — no DB dependency. Authoritative version now
// lives server-side (this file); the browser only shows a live preview using its own copy
// of the same logic, but the server always recomputes from the submitted raw scores rather
// than trusting whatever the client says the final numbers are.

export function round1(n) { return Math.round((n || 0) * 10) / 10; }
export function round2(n) { return Math.round((n || 0) * 100) / 100; }

export function scoreParameter(weight, scorePercent) {
  const clamped = Math.max(0, Math.min(100, scorePercent));
  return round2((weight * clamped) / 100);
}

export const RATING_BANDS = [
  { label: "Excellent", min: 95, max: 100 },
  { label: "Good", min: 85, max: 94.99 },
  { label: "Needs Improvement", min: 70, max: 84.99 },
  { label: "Poor", min: 0, max: 69.99 },
];
const LABEL_TO_CODE = { "Excellent": "EXCELLENT", "Good": "GOOD", "Needs Improvement": "NEEDS_IMPROVEMENT", "Poor": "POOR" };

export function getRatingLabel(overall, maxPossible) {
  const pct = maxPossible > 0 ? (overall / maxPossible) * 100 : 0;
  for (const b of RATING_BANDS) if (pct >= b.min && pct <= b.max) return b.label;
  return "Poor";
}

export function computeFinalResult(overall, maxPossible, ztpConfirmed) {
  const label = getRatingLabel(overall, maxPossible);
  if (ztpConfirmed) return { rating: "FAIL - ZTP", finalResultCode: "FAIL_ZTP", passed: false };
  return { rating: label, finalResultCode: LABEL_TO_CODE[label] || "POOR", passed: true };
}

export function isCoachingRequired(overall, maxPossible, ztpConfirmed, paramResults) {
  if (ztpConfirmed) return true;
  if (paramResults.some((p) => p.severity === "MAJOR" && p.scorePercent < 50)) return true;
  const pct = maxPossible > 0 ? (overall / maxPossible) * 100 : 0;
  return pct < 85;
}

export function getCoachingPriority(overall, maxPossible, ztpConfirmed, paramResults) {
  if (ztpConfirmed) return "HIGH";
  const pct = maxPossible > 0 ? (overall / maxPossible) * 100 : 0;
  const hasMajorError = paramResults.some((p) => p.severity === "MAJOR" && p.scorePercent < 50);
  if (pct < 70 || hasMajorError) return "HIGH";
  if (pct < 85) return "MEDIUM";
  const hasMinorError = paramResults.some((p) => p.scorePercent < 50);
  if (hasMinorError) return "LOW";
  return "NONE";
}

export function computeRag(value, targetOperator, targetValue, amberThreshold) {
  if (targetOperator === ">=") {
    if (value >= targetValue) return "GREEN";
    if (value >= amberThreshold) return "AMBER";
    return "RED";
  }
  if (value <= targetValue) return "GREEN";
  if (value <= amberThreshold) return "AMBER";
  return "RED";
}
