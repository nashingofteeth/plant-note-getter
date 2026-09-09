const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const backend = require('../src/llm-backend');

const ENV_KEYS = ['LLM_SERVER_URL', 'LLM_MODEL'];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
const originalFetch = global.fetch;
const originalWarn = console.warn;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = originalFetch;
  console.warn = originalWarn;
  backend.resetCompleter();
});

function useOllama() {
  delete process.env.LLM_SERVER_URL;
  process.env.LLM_MODEL = 'test-model';
  backend.resetCompleter();
}

function stubFetch(handler) {
  const calls = [];
  console.warn = () => {};
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

const SCHEMA = { type: 'object', properties: { add: { type: 'array' } } };

test('ollama: builds the expected /api/chat request and returns trimmed content', async () => {
  useOllama();
  const calls = stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return okJson({ message: { content: '  {"add":[],"remove":[]}  ' } });
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(typeof complete, 'function');
  const out = await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(out, '{"add":[],"remove":[]}');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].url, 'http://localhost:11434/api/tags');
  const chat = calls[1];
  assert.strictEqual(chat.url, 'http://localhost:11434/api/chat');
  assert.strictEqual(chat.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(chat.init.body), {
    model: 'test-model',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user' }
    ],
    stream: false,
    think: false,
    options: { temperature: 0, num_predict: 2048 },
    format: SCHEMA
  });
});

test('ollama: honors LLM_SERVER_URL (trailing slash) and LLM_MODEL overrides', async () => {
  useOllama();
  process.env.LLM_SERVER_URL = 'http://127.0.0.1:11435/';
  process.env.LLM_MODEL = 'custom-model';
  const calls = stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return okJson({ message: { content: '{}' } });
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(calls[0].url, 'http://127.0.0.1:11435/api/tags');
  const body = JSON.parse(calls[1].init.body);
  assert.strictEqual(calls[1].url, 'http://127.0.0.1:11435/api/chat');
  assert.strictEqual(body.model, 'custom-model');
});

test('ollama: omits format when no jsonSchema is passed', async () => {
  useOllama();
  const calls = stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return okJson({ message: { content: '{}' } });
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user');
  const body = JSON.parse(calls[1].init.body);
  assert.ok(!('format' in body));
});

test('ollama: missing LLM_MODEL yields a null completer without probing', async () => {
  delete process.env.LLM_SERVER_URL;
  delete process.env.LLM_MODEL;
  backend.resetCompleter();
  const calls = stubFetch(() => okJson({ models: [] }));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 0);
});

test('ollama: probe failure yields a null completer', async () => {
  useOllama();
  stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.strictEqual(await backend.getCompleter(), null);
});

test('ollama: unreachable daemon yields a null completer', async () => {
  useOllama();
  stubFetch(() => {
    throw new Error('connect ECONNREFUSED');
  });
  assert.strictEqual(await backend.getCompleter(), null);
});

test('ollama: chat HTTP error rejects the completion', async () => {
  useOllama();
  stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return { ok: false, status: 500, json: async () => ({}) };
  });
  const complete = await backend.getCompleter();
  await assert.rejects(() => complete('sys', 'user', {}), /ollama chat failed: HTTP 500/);
});

test('ollama: missing message content resolves to empty string', async () => {
  useOllama();
  stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return okJson({ message: {} });
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(await complete('sys', 'user', {}), '');
});
