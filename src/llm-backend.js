// LLM completer (advisory second pass for common-name extraction).
//
// Two interchangeable backends, selected by LLM_BACKEND:
//   - 'opencode' (default): remote models through the opencode server HTTP
//     API. LLM_MODEL is 'provider/model' (e.g. anthropic/claude-sonnet-4-5);
//     credentials live in opencode itself — no API keys in this repo. If no
//     server is reachable, one is auto-started as a detached `opencode serve`
//     daemon unless OPENCODE_AUTOSTART=false. JSON output is enforced by the
//     server's structured-output format (json_schema) instead of a grammar.
//   - 'ollama': local Ollama daemon over HTTP (LLM_SERVER_URL, model
//     LLM_MODEL) with grammar-constrained JSON output.
// No in-process ML stack, no API keys. The completer is a lazy singleton:
// any failure yields a null completer so the deterministic regex pipeline
// always keeps working.

const { spawn } = require('child_process');

const DEFAULT_SERVER_URL = 'http://localhost:11434';
const DEFAULT_OPENCODE_URL = 'http://localhost:4096';
const OPENCODE_AUTOSTART_TIMEOUT = 15000;

// Basic auth for a password-protected opencode server
// (OPENCODE_SERVER_PASSWORD / OPENCODE_SERVER_USERNAME, mirroring `opencode
// serve`'s own env vars). Empty when no password is set.
function basicAuthHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD || '';
  if (!password) return {};
  const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  return { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` };
}

// Split an LLM_MODEL of the form 'provider/model' (first slash separates, so
// nested model paths like openrouter/anthropic/... keep their full modelID).
function parseOpencodeModel(model) {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

// Probe the opencode server's health endpoint. Throws on unreachable/!ok so
// callers can distinguish "not up yet" from "up".
async function healthCheck(baseUrl) {
  const res = await fetch(`${baseUrl}/global/health`, {
    headers: basicAuthHeaders(),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) {
    throw new Error(`opencode server probe failed: HTTP ${res.status}`);
  }
}

// Start a detached `opencode serve` daemon for baseUrl and poll /global/health
// until it answers. Only sensible for local hostnames — a remote opencode
// server cannot be spawned from here. The daemon is intentionally left
// running after this process exits so later runs reuse it.
async function _spawnServe(baseUrl) {
  const url = new URL(baseUrl);
  const hostname = url.hostname || '127.0.0.1';
  const port = url.port || '4096';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      `opencode server unreachable at ${baseUrl} and OPENCODE_AUTOSTART only ` +
        'supports local hosts — start it manually with `opencode serve`'
    );
  }
  const child = spawn('opencode', ['serve', '--hostname', hostname, '--port', port], {
    stdio: 'ignore',
    detached: true
  });
  child.unref();
  const deadline = Date.now() + OPENCODE_AUTOSTART_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      await healthCheck(baseUrl);
      return;
    } catch {
      // daemon not up yet — keep polling until the deadline
    }
  }
  throw new Error(
    `opencode serve did not become healthy on ${baseUrl} within ${OPENCODE_AUTOSTART_TIMEOUT}ms`
  );
}

// Pull the completion text out of the message endpoint response. With
// structured output the validated JSON arrives as info.structured (any JSON
// value, stringified here when needed); otherwise assistant text parts are
// joined. Message-level error shapes (StructuredOutputError,
// ProviderAuthError, ...) surface as thrown errors so the reviewer records
// reason 'completer-error' instead of parsing junk.
function extractCompletion(data) {
  const info = data && data.info;
  if (info && info.error) {
    const detail = info.error.message ? `: ${info.error.message}` : '';
    throw new Error(`opencode chat failed: ${info.error.name || 'error'}${detail}`);
  }
  const structured = info && info.structured;
  if (structured !== undefined && structured !== null) {
    return typeof structured === 'string' ? structured.trim() : JSON.stringify(structured);
  }
  const parts = (data && data.parts) || [];
  return parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

// External opencode server completer. Each completion runs in its own
// one-shot session (created per call, deleted afterwards) so the two reviewer
// passes stay independent. Structured output via body.format replaces the
// Ollama grammar constraint; no temperature control exists on this API.
// No default model: without LLM_MODEL in 'provider/model' form there is
// nothing to complete with, so this throws and getCompleter below degrades
// to a null completer. A cheap /global/health probe at build time turns an
// unreachable server into either an auto-started daemon (default) or a null
// completer (OPENCODE_AUTOSTART=false) instead of failing on the first review.
async function buildOpencodeCompleter() {
  const baseUrl = (process.env.OPENCODE_SERVER_URL || DEFAULT_OPENCODE_URL).replace(/\/+$/, '');
  const model = (process.env.LLM_MODEL || '').trim();
  if (!model) {
    throw new Error('LLM_MODEL is not set — reviewer disabled');
  }
  const parsed = parseOpencodeModel(model);
  if (!parsed) {
    throw new Error(
      `LLM_MODEL '${model}' is not 'provider/model' — the opencode backend needs e.g. anthropic/claude-sonnet-4-5`
    );
  }
  try {
    await healthCheck(baseUrl);
  } catch (err) {
    if (process.env.OPENCODE_AUTOSTART === 'false') throw err;
    await module.exports._spawnServe(baseUrl);
  }
  return async function complete(systemPrompt, userPrompt, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...basicAuthHeaders() };
    const created = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'plant-note-getter reviewer' }),
      signal: AbortSignal.timeout(30000)
    });
    if (!created.ok) {
      throw new Error(`opencode session create failed: HTTP ${created.status}`);
    }
    const session = await created.json();
    const sessionId = session && session.id;
    if (!sessionId) {
      throw new Error('opencode session create returned no session id');
    }
    try {
      const body = {
        model: parsed,
        system: systemPrompt,
        parts: [{ type: 'text', text: userPrompt }]
      };
      if (options && options.jsonSchema) {
        body.format = { type: 'json_schema', schema: options.jsonSchema };
      }
      const res = await fetch(`${baseUrl}/session/${sessionId}/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600000)
      });
      if (!res.ok) {
        throw new Error(`opencode chat failed: HTTP ${res.status}`);
      }
      const data = await res.json();
      return extractCompletion(data);
    } finally {
      // One-shot session: best-effort cleanup, failures are harmless.
      fetch(`${baseUrl}/session/${sessionId}`, {
        method: 'DELETE',
        headers,
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});
    }
  };
}

// External Ollama daemon completer. Talks to the daemon's native /api/chat
// endpoint (grammar-constrained output when options.jsonSchema is given).
// No default model: without LLM_MODEL there is nothing to complete with,
// so this throws and getCompleter below degrades to a null completer.
// A cheap /api/tags probe at build time turns an unreachable daemon into a
// null completer immediately instead of failing on the first review.
async function buildOllamaCompleter() {
  const baseUrl = (process.env.LLM_SERVER_URL || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || '';
  if (!model) {
    throw new Error('LLM_MODEL is not set — reviewer disabled');
  }
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

async function buildCompleter() {
  const backend = (process.env.LLM_BACKEND || 'opencode').toLowerCase();
  if (backend === 'opencode') return buildOpencodeCompleter();
  if (backend === 'ollama') return buildOllamaCompleter();
  throw new Error(`unknown LLM_BACKEND '${backend}' — expected 'opencode' or 'ollama'`);
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
  DEFAULT_SERVER_URL,
  DEFAULT_OPENCODE_URL,
  parseOpencodeModel,
  extractCompletion,
  _spawnServe
};
