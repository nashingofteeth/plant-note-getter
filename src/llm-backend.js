// Local LLM completer (advisory second pass for common-name extraction).
//
// Loads a small instruct model via transformers.js and runs it fully on the
// local machine (no API keys, no network at inference time). Greedy decoding
// is used so output is reproducible. The completer is a lazy singleton: the
// first call downloads the model (cached afterwards), and any failure yields
// a null completer so the deterministic regex pipeline always keeps working.

const { pipeline } = require('@huggingface/transformers');

const DEFAULT_MODEL_ID = 'onnx-community/Qwen2.5-1.5B-Instruct';

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

module.exports = { getCompleter, resetCompleter, DEFAULT_MODEL_ID, toText };