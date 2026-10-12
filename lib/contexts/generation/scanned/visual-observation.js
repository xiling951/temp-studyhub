import { IMAGE_OBSERVER_VERSION, isImageObservation } from '../../../visual-observations.js';

export const IMAGE_OBSERVER_PROMPT = `你是盲图观察者。只接收真实原图和图块身份，不接收题目、答案、作者分析、OCR或图注。先观察原图，不推测后续题目，不进行教学求解。列出可直接看到的物体、位置、标记、连接、坐标和单位。对于有输入端的器件，把已连接输入线与未连接的短输入端逐个分开枚举，不能只数悬空短线；总输入数必须等于两者之和，输出线不属于输入。相邻平行短线不可合并。报告相对位置供再次定位。读不清的具体项写uncertainties，并把相关inputCountUncertain设true。没有输入端的图表对象设totalInputs:null及两个空数组。kind是可观察形状或器件类型，不能从后续问题猜测。只返回严格JSON，不超过24个objects和24条visibleFacts：{"objects":[{"label":"图中真实标签，无标签则位置名","kind":"观察到的类型/形状","region":[0.1,0.1,0.9,0.9],"connectedInputs":[],"unconnectedInputs":[],"totalInputs":null,"inputCountUncertain":true}],"visibleFacts":["简明直接可观察事实"],"uncertainties":[]}。示例仅说明JSON结构，实际计数和图形必须由当前原图决定。`;

/** Persist a completed observation before the independent question call; retries reuse it by immutable image and real route. */
export async function observeVisualEvidence({ materials, citations, route, signal, jobId, attemptId, ask }) {
  if (!materials?.observationLookup || !materials?.observationCommit) throw new Error('Trusted blind image observation services are unavailable');
  const observations = [];
  for (const citation of citations) {
    signal?.throwIfAborted();
    const args = { citation, route, observerVersion: IMAGE_OBSERVER_VERSION };
    let receipt = await materials.observationLookup(args, { signal });
    if (!receipt) {
      const identity = Object.fromEntries(['documentId', 'revision', 'page', 'blockId', 'assetId', 'imageHash', 'bbox'].map(key => [key, citation[key]]));
      const result = await ask({ system: IMAGE_OBSERVER_PROMPT, data: { image: identity }, citation });
      if (result.route?.provider !== route?.provider || result.route?.model !== route?.model) throw new Error('Image observer route changed; no observation cached');
      if (!isImageObservation(result.value)) throw new Error('Blind image observation has invalid counts, positions or format');
      receipt = await materials.observationCommit({ ...args, value: result.value, jobId, attemptId }, { signal });
    }
    observations.push({ key: receipt.key, blockId: citation.blockId, imageHash: citation.imageHash, value: receipt.value });
  }
  return observations;
}
