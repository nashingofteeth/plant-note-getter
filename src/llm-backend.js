// LLM completer (advisory second pass for common-name extraction).
//
// Two interchangeable backends, selected by LLM_BACKEND:
//   - 'opencode' (default): remote models through the opencode V2 server.
//     LLM_MODEL is 'provider/model' (e.g. anthropic/claude-sonnet-4-5);
//     credentials live in opencode itself — no API keys in this repo.
//     Requests go through the `opencode api` CLI, which owns service
//     discovery, authentication, and auto-start of the background service.
//     Set OPENCODE_SERVER_URL to target a specific server (passed to
//     `opencode api --server`); OPENCODE_SERVER_PASSWORD authenticates
//     against a password-protected server. Each completion runs in its own
//     one-shot session: create (with the model) → generate text → delete.
//     The V2 generate route has no structured-output field, so the JSON
//     schema is appended to the prompt and the reviewer's tolerant parser
//     handles fences/prose.
//   - 'ollama': local Ollama daemon over HTTP (LLM_SERVER_URL, model
//     LLM_MODEL) with grammar-constrained JSON output.
// No in-process ML stack, no API keys. The completer is a lazy singleton:
// any failure yields a null completer so the deterministic regex pipeline
// always keeps working.

const { spawn } = require('child_process');

const DEFAULT_SERVER_URL = 'http://localhost:11434';

// Spawn `opencode api <args>` for one request and capture its output. Kept as
// a named export so tests can stub the transport without a real CLI. Resolves
// { stdout, stderr, code }; rejects only when the process cannot be spawned.
function _runApi(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('opencode', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

// Build the `opencode api` argv for one request. With OPENCODE_SERVER_URL set
// the CLI is pinned to that server (no discovery/auto-start); otherwise it
// discovers the shared background service.
function buildApiArgs(method, apiPath, body) {
  const args = ['api', method, apiPath];
  const serverUrl = (process.env.OPENCODE_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (serverUrl) args.push('--server', serverUrl);
  if (body !== undefined) args.push('--data', JSON.stringify(body));
  return args;
}

// One request against the opencode V2 server through `opencode api`. Returns
// the parsed JSON body; throws the server's message on a non-zero exit so the
// reviewer records reason 'completer-error' instead of parsing junk.
async function runOpencodeApi(method, apiPath, body) {
  const env = {};
  if (process.env.OPENCODE_SERVER_PASSWORD) env.OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;
  const { stdout, stderr, code } = await module.exports._runApi(
    buildApiArgs(method, apiPath, body),
    { env }
  );
  const text = String(stdout || '').trim();
  let parsed = null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      parsed = null;
    }
  }
  if (code !== 0) {
    const stderrLine = String(stderr || '').trim().split('\n')[0];
    const message =
      (parsed && parsed.message) || stderrLine || `opencode api exited with code ${code}`;
    throw new Error(`opencode api ${method.toUpperCase()} ${apiPath} failed: ${message}`);
  }
  return parsed;
}

// Split an LLM_MODEL of the form 'provider/model' (first slash separates, so
// nested model paths like openrouter/anthropic/... keep their full modelID).
function parseOpencodeModel(model) {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) return null;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

// External opencode V2 completer. Each completion runs in its own one-shot
// session (created with the model, deleted afterwards) so the two reviewer
// passes stay independent. No default model: without LLM_MODEL in
// 'provider/model' form there is nothing to complete with, so this throws and
// getCompleter below degrades to a null completer. A cheap /api/info request
// at build time turns an unreachable server (or a missing `opencode` CLI)
// into a null completer instead of failing on the first review.
async function buildOpencodeCompleter() {
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
  await runOpencodeApi('get', '/api/info');

  const modelRef = { providerID: parsed.providerID, id: parsed.modelID };

  // Per-call usage stats for cost reporting (see reviewWikipediaNames):
  // each entry is { ms, cost, tokens } with tokens as { input, output }.
  // The V2 generate route reports no usage, so cost/tokens stay null and
  // callers skip display instead of printing a misleading $0.00.
  async function complete(systemPrompt, userPrompt, options = {}) {
    const t0 = Date.now();
    const created = await runOpencodeApi('post', '/api/session', {
      title: 'plant-note-getter reviewer',
      model: modelRef
    });
    const sessionId = created && created.data && created.data.id;
    if (!sessionId) {
      throw new Error('opencode session create returned no session id');
    }
    try {
      let prompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
      if (options && options.jsonSchema) {
        prompt += `\n\nRespond with a single JSON object matching this JSON Schema:\n${JSON.stringify(
          options.jsonSchema
        )}`;
      }
      const generated = await runOpencodeApi('post', `/api/session/${sessionId}/generate`, {
        prompt
      });
      const text =
        generated && generated.data && typeof generated.data.text === 'string'
          ? generated.data.text.trim()
          : '';
      complete.calls.push({ ms: Date.now() - t0, cost: null, tokens: null });
      return text;
    } finally {
      // One-shot session: best-effort cleanup, failures are harmless.
      runOpencodeApi('delete', `/api/session/${sessionId}`).catch(() => {});
    }
  }
  complete.calls = [];
  return complete;
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
  async function complete(systemPrompt, userPrompt, options = {}) {
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
    const t0 = Date.now();
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
    // Local daemon: no cost; token counts when the daemon reports them.
    complete.calls.push({
      ms: Date.now() - t0,
      cost: 0,
      tokens: {
        input: typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : null,
        output: typeof data.eval_count === 'number' ? data.eval_count : null
      }
    });
    return typeof content === 'string' ? content.trim() : '';
  }
  complete.calls = [];
  return complete;
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
  parseOpencodeModel,
  buildApiArgs,
  runOpencodeApi,
  _runApi
};
