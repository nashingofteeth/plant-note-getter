// Local LLM completer (advisory second pass for common-name extraction).
//
// Two backends (selected by LLM_BACKEND):
//   'transformers' (default) — loads a small instruct model via transformers.js
//     and runs it fully in-process on the local machine (no API keys, no
//     network at inference time).
//   'ollama' — talks to an external Ollama daemon over HTTP (LLM_SERVER_URL,
//     model LLM_MODEL). No node ML stack; supports grammar-constrained JSON
//     output when the caller passes options.jsonSchema.
// Greedy decoding is used so output is reproducible. The completer is a lazy
// singleton: any failure yields a null completer so the deterministic regex
// pipeline always keeps working.

const { pipeline } = require('@huggingface/transformers');

const DEFAULT_MODEL_ID = 'onnx-community/Qwen2.5-1.5B-Instruct';
const DEFAULT_SERVER_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen3:4b-instruct-2507-q4_K_M';

function toText(output) {
  if (output == null) return '';
  if (typeof output === 'string') return output.trim();
  const item = Array.isArray(output) ? output[0] : output;
  if (item == null) return '';
  const gt = item.generated_text;
  if (gt == null) return String(item).trim();
  if (typeof gt === 'string') return gt.trim();
  if (Array.isArray(gt)) {
    return gt
      .filter((m) => m && m.role === 'assistant' && m.content)
      .map((m) => m.content)
      .join('')
      .trim();
  }
  return '';
}

async function buildCompleter() {
  if ((process.env.LLM_BACKEND || 'transformers') === 'ollama') {
    return buildOllamaCompleter();
  }
  return buildTransformersCompleter();
}

async function buildTransformersCompleter() {
  const modelId = process.env.LLM_MODEL_ID || DEFAULT_MODEL_ID;
  const generator = await pipeline('text-generation', modelId, {
    dtype: 'q8',
    device: 'cpu'
  });
  return async function complete(systemPrompt, userPrompt) {
    const output = await generator(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        max_new_tokens: 512,
        do_sample: false
      }
    );
    return toText(output);
  };
}

// External Ollama daemon completer. Talks to the daemon's native /api/chat
// endpoint (grammar-constrained output when options.jsonSchema is given).
// A cheap /api/tags probe at build time turns an unreachable daemon into a
// null completer immediately instead of failing on the first review.
async function buildOllamaCompleter() {
  const baseUrl = (process.env.LLM_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || DEFAULT_OLLAMA_MODEL;
  const probeRes = await fetch(`${baseUrl}/api/tags`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!probeRes.ok) {
    throw new Error(`ollama daemon probe failed: HTTP ${probeRes.status}`);
  }
  return async function complete(systemPrompt, userPrompt, options = {}) {
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 2048 }
    };
    if (options && options.jsonSchema) body.format = options.jsonSchema;
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000)
    });
    if (!res.ok) {
      throw new Error(`ollama chat failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    const content = data && data.message && data.message.content;
    return typeof content === 'string' ? content.trim() : '';
  };
}

let completerPromise = null;

function getCompleter() {
  if (!completerPromise) {
    completerPromise = buildCompleter().catch((err) => {
      console.warn(`[llm] reviewer disabled: ${err && err.message ? err.message : err}`);
      return null;
    });
  }
  return completerPromise;
}

function resetCompleter() {
  completerPromise = null;
}

module.exports = {
  getCompleter,
  resetCompleter,
  DEFAULT_MODEL_ID,
  DEFAULT_SERVER_URL,
  DEFAULT_OLLAMA_MODEL,
  toText
};