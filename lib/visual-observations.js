/** Blind observations are model evidence, never source text or approval. */
export const IMAGE_OBSERVER_VERSION = 1;
const words = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;
const list = (value, max, length) => Array.isArray(value) && value.length <= max && value.every(item => words(item, length)) && new Set(value).size === value.length;

export function isImageObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['objects', 'visibleFacts', 'uncertainties'].includes(key)) ||
    !Array.isArray(value.objects) || value.objects.length > 24 || !list(value.visibleFacts, 24, 800) || !value.visibleFacts.length ||
    !list(value.uncertainties, 16, 500) || JSON.stringify(value).length > 24000) return false;
  const labels = new Set();
  return value.objects.every(object => {
    if (!object || Object.keys(object).some(key => !['label', 'kind', 'region', 'connectedInputs', 'unconnectedInputs', 'totalInputs', 'inputCountUncertain'].includes(key)) ||
      !words(object.label, 120) || labels.has(object.label) || !words(object.kind, 120) || typeof object.inputCountUncertain !== 'boolean' ||
      !Array.isArray(object.region) || object.region.length !== 4 || object.region.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
      object.region[0] >= object.region[2] || object.region[1] >= object.region[3] ||
      !list(object.connectedInputs, 16, 180) || !list(object.unconnectedInputs, 16, 180)) return false;
    labels.add(object.label);
    const inputs = [...object.connectedInputs, ...object.unconnectedInputs];
    if (new Set(inputs).size !== inputs.length) return false;
    return object.totalInputs === null ? inputs.length === 0 : Number.isInteger(object.totalInputs) && object.totalInputs >= 0 && object.totalInputs <= 32 && object.totalInputs === inputs.length;
  });
}
