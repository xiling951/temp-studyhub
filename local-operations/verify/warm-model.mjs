// Warm the embedding-model cache StudyHub's search extension uses, so the
// index build inside the harness needs no outbound fetch.
// Run with HTTPS_PROXY + NODE_USE_ENV_PROXY=1 in the environment.
import { env, pipeline } from 'file:///D:/studyhub/dsh-home/profiles/web/node_modules/@huggingface/transformers/dist/transformers.node.mjs'

const CACHE = 'D:/studyhub/dsh-home/study/retrieval/models'
env.cacheDir = CACHE
console.log('proxy env seen by this process:', {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY,
})
const started = Date.now()
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
console.log(`model loaded in ${Math.round((Date.now() - started) / 1000)}s`)
const output = await extractor(['StudyHub retrieval warm-up'], { pooling: 'mean', normalize: true })
console.log('embedding ok, dims =', JSON.stringify(output.dims))
