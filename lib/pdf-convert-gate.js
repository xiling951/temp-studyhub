import { admitSlot } from './jobs/scheduler.js';
const gates = new WeakMap();
export function pdfConvertGate(jobs) {
  let gate = gates.get(jobs);
  if (!gate) { gate = { limit: 1, active: new Set(), waiting: [] }; gates.set(jobs, gate); }
  return gate;
}
export async function holdPdfSlot(context, gate) {
  let start, finish;
  const admitted = new Promise(resolve => { start = resolve; }), held = new Promise(resolve => { finish = resolve; });
  const drained = admitSlot(gate, context.attemptId, context.signal, () => { start(); return held; });
  await Promise.race([admitted, drained]); context.signal.throwIfAborted();
  return { async finish() { finish(); await drained; } };
}
