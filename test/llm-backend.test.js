const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const backend = require('../src/llm-backend');

const ENV_KEYS = [
  'LLM_BACKEND',
  'LLM_SERVER_URL',
  'LLM_MODEL',
  'OPENCODE_SERVER_URL',
  'OPENCODE_AUTOSTART',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME'
];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
const originalFetch = global.fetch;
const originalWarn = console.warn;
const originalSpawnServe = backend._spawnServe;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = originalFetch;
  console.warn = originalWarn;
  backend._spawnServe = originalSpawnServe;
  backend.resetCompleter();
});

function useOllama() {
  process.env.LLM_BACKEND = 'ollama';
  delete process.env.LLM_SERVER_URL;
  process.env.LLM_MODEL = 'test-model';
  backend.resetCompleter();
}

function useOpencode() {
  process.env.LLM_BACKEND = 'opencode';
  delete process.env.OPENCODE_SERVER_URL;
  delete process.env.OPENCODE_AUTOSTART;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_USERNAME;
  process.env.LLM_MODEL = 'test-provider/test-model';
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

function useOpencodeServer(handler) {
  const calls = stubFetch((url, init) => {
    if (String(url).endsWith('/global/health')) return okJson({ healthy: true, version: 'test' });
    return handler(url, init);
  });
  return calls;
}

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
  useOllama();
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

test('opencode: builds session/message requests and returns stringified structured output', async () => {
  useOpencode();
  const calls = useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_abc' });
    if (url.endsWith('/message')) {
      return okJson({
        info: { id: 'msg_1', structured: { add: ['X'], remove: [] } },
        parts: [{ type: 'text', text: '  {"add":["X"],"remove":[]}  ' }]
      });
    }
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(typeof complete, 'function');
  const out = await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(out, '{"add":["X"],"remove":[]}');
  assert.strictEqual(calls.length, 4);
  assert.strictEqual(calls[0].url, 'http://localhost:4096/global/health');
  const create = calls[1];
  assert.strictEqual(create.url, 'http://localhost:4096/session');
  assert.strictEqual(create.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(create.init.body), { title: 'plant-note-getter reviewer' });
  const chat = calls[2];
  assert.strictEqual(chat.url, 'http://localhost:4096/session/ses_abc/message');
  assert.strictEqual(chat.init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(chat.init.body), {
    model: { providerID: 'test-provider', modelID: 'test-model' },
    system: 'sys',
    parts: [{ type: 'text', text: 'user' }],
    format: { type: 'json_schema', schema: SCHEMA }
  });
  assert.strictEqual(calls[3].url, 'http://localhost:4096/session/ses_abc');
  assert.strictEqual(calls[3].init.method, 'DELETE');
});

test('opencode: honors OPENCODE_SERVER_URL (trailing slash) and LLM_MODEL overrides', async () => {
  useOpencode();
  process.env.OPENCODE_SERVER_URL = 'http://127.0.0.1:4999/';
  process.env.LLM_MODEL = 'openrouter/anthropic/claude-3.5-sonnet';
  const calls = useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) return okJson({ info: {}, parts: [{ type: 'text', text: '{}' }] });
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(calls[0].url, 'http://127.0.0.1:4999/global/health');
  assert.strictEqual(calls[2].url, 'http://127.0.0.1:4999/session/ses_1/message');
  const body = JSON.parse(calls[2].init.body);
  assert.deepStrictEqual(body.model, { providerID: 'openrouter', modelID: 'anthropic/claude-3.5-sonnet' });
});

test('opencode: omits format when no jsonSchema is passed', async () => {
  useOpencode();
  const calls = useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) return okJson({ info: {}, parts: [{ type: 'text', text: '{}' }] });
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user');
  const body = JSON.parse(calls[2].init.body);
  assert.ok(!('format' in body));
});

test('opencode: falls back to joined text parts, ignoring non-text parts', async () => {
  useOpencode();
  useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) {
      return okJson({
        info: {},
        parts: [
          { type: 'reasoning', text: 'let me think' },
          { type: 'text', text: '{"add":' },
          { type: 'other', text: 'junk' },
          { type: 'text', text: '[]}' }
        ]
      });
    }
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(await complete('sys', 'user', { jsonSchema: SCHEMA }), '{"add":\n[]}');
});

test('opencode: message-level error info rejects the completion', async () => {
  useOpencode();
  useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) {
      return okJson({ info: { error: { name: 'StructuredOutputError', message: 'no valid output' } }, parts: [] });
    }
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  await assert.rejects(
    () => complete('sys', 'user', { jsonSchema: SCHEMA }),
    /opencode chat failed: StructuredOutputError: no valid output/
  );
});

test('opencode: missing LLM_MODEL yields a null completer without probing', async () => {
  useOpencode();
  delete process.env.LLM_MODEL;
  backend.resetCompleter();
  const calls = useOpencodeServer(() => okJson({ healthy: true, version: 'test' }));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 0);
});

test('opencode: LLM_MODEL without a provider slash yields a null completer', async () => {
  useOpencode();
  process.env.LLM_MODEL = 'qwen3:4b';
  backend.resetCompleter();
  const calls = useOpencodeServer(() => okJson({ healthy: true, version: 'test' }));
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 0);
  assert.ok(warnings.some((w) => w.includes('provider/model')));
});

test('opencode: probe failure with autostart disabled yields a null completer', async () => {
  useOpencode();
  process.env.OPENCODE_AUTOSTART = 'false';
  backend._spawnServe = async () => {
    throw new Error('must not spawn');
  };
  const calls = stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 1);
});

test('opencode: unreachable local server is auto-started', async () => {
  useOpencode();
  const spawned = [];
  backend._spawnServe = async (baseUrl) => {
    spawned.push(baseUrl);
  };
  let healthCalls = 0;
  const calls = stubFetch((url) => {
    if (String(url).endsWith('/global/health')) {
      healthCalls++;
      if (healthCalls <= 2) throw new Error('connect ECONNREFUSED');
      return okJson({ healthy: true, version: 'test' });
    }
    return okJson({});
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(typeof complete, 'function');
  assert.deepStrictEqual(spawned, ['http://localhost:4096']);
  assert.strictEqual(healthCalls, 1);
});

test('opencode: failed autostart yields a null completer', async () => {
  useOpencode();
  backend._spawnServe = async () => {
    throw new Error('opencode serve did not become healthy');
  };
  stubFetch(() => {
    throw new Error('connect ECONNREFUSED');
  });
  assert.strictEqual(await backend.getCompleter(), null);
});

test('opencode: sends basic auth when OPENCODE_SERVER_PASSWORD is set', async () => {
  useOpencode();
  process.env.OPENCODE_SERVER_PASSWORD = 'secret';
  const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
  const calls = useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) return okJson({ info: {}, parts: [{ type: 'text', text: '{}' }] });
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  for (const call of calls) {
    assert.strictEqual(call.init.headers.Authorization, expected);
  }
});

test('opencode: completer records per-call cost and tokens on complete.calls', async () => {
  useOpencode();
  useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) {
      return okJson({
        info: { structured: { add: [] }, cost: 0.006, tokens: { input: 17314, output: 140 } },
        parts: []
      });
    }
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  assert.deepStrictEqual(complete.calls, []);
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(complete.calls.length, 1);
  assert.strictEqual(complete.calls[0].cost, 0.006);
  assert.deepStrictEqual(complete.calls[0].tokens, { input: 17314, output: 140 });
  assert.strictEqual(typeof complete.calls[0].ms, 'number');
});

test('opencode: missing cost/tokens in info records nulls, not zeros', async () => {
  useOpencode();
  useOpencodeServer((url, init) => {
    if (url.endsWith('/session') && init.method === 'POST') return okJson({ id: 'ses_1' });
    if (url.endsWith('/message')) return okJson({ info: {}, parts: [{ type: 'text', text: '{}' }] });
    if (init.method === 'DELETE') return okJson(true);
    return okJson({});
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user');
  assert.strictEqual(complete.calls[0].cost, null);
  assert.deepStrictEqual(complete.calls[0].tokens, { input: null, output: null });
});

test('ollama: completer records eval counts with zero cost on complete.calls', async () => {
  useOllama();
  stubFetch((url) => {
    if (url.endsWith('/api/tags')) return okJson({ models: [] });
    return okJson({ message: { content: '{}' }, prompt_eval_count: 100, eval_count: 20 });
  });
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(complete.calls.length, 1);
  assert.strictEqual(complete.calls[0].cost, 0);
  assert.deepStrictEqual(complete.calls[0].tokens, { input: 100, output: 20 });
});

test('parseOpencodeModel splits on the first slash and rejects malformed specs', () => {
  assert.deepStrictEqual(backend.parseOpencodeModel('anthropic/claude-sonnet-4-5'), {
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5'
  });
  assert.deepStrictEqual(backend.parseOpencodeModel('openrouter/anthropic/claude-3.5-sonnet'), {
    providerID: 'openrouter',
    modelID: 'anthropic/claude-3.5-sonnet'
  });
  assert.strictEqual(backend.parseOpencodeModel('qwen3:4b'), null);
  assert.strictEqual(backend.parseOpencodeModel('/model'), null);
  assert.strictEqual(backend.parseOpencodeModel('provider/'), null);
  assert.strictEqual(backend.parseOpencodeModel(''), null);
});
