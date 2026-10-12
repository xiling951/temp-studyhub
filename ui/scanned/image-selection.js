/** Each path step inherits only images from its own immutable source pages. */
export function targetsForEvidence(evidence, sourceIds) {
  const wanted = new Set(sourceIds), grouped = new Map();
  for (const item of evidence || []) {
    if (!wanted.has(item.sourceId)) continue;
    const key = JSON.stringify([item.documentId, item.revision]);
    if (!grouped.has(key)) grouped.set(key, { documentId: item.documentId, revision: item.revision, blockIds: [] });
    const target = grouped.get(key); if (!target.blockIds.includes(item.blockId)) target.blockIds.push(item.blockId);
  }
  return [...grouped.values()];
}
