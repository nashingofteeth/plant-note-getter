const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const backend = require('../src/llm-backend');

const ENV_KEYS = [
  'LLM_BACKEND',
  'LLM_SERVER_URL',
  'LLM_MODEL',
  'OPENCODE_SERVER_URL',
  'OPENCODE_SERVER_PASSWORD',
  'OPENCODE_SERVER_USERNAME'
];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
const originalFetch = global.fetch;
const originalWarn = console.warn;
const originalRunApi = backend._runApi;

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  global.fetch = originalFetch;
  console.warn = originalWarn;
  backend._runApi = originalRunApi;
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

// Stub the `opencode api` transport. Records { args, options } per call.
function stubApi(handler) {
  const calls = [];
  console.warn = () => {};
  backend._runApi = async (args, options) => {
    const call = { args, options };
    calls.push(call);
    return handler(args, options);
  };
  return calls;
}

// Read the JSON payload after `--data` from an `opencode api` argv.
const dataArg = (args) => JSON.parse(args[args.indexOf('--data') + 1]);

const okApi = (body) => ({ stdout: JSON.stringify(body), stderr: '', code: 0 });
const errApi = (body, http = 'HTTP 500 Internal Server Error') => ({
  stdout: body === undefined ? '' : JSON.stringify(body),
  stderr: http,
  code: 1
});

// Happy-path handler: probe, create session, generate, delete.
function happyApiHandler({ text = '{"add":[],"remove":[]}', create = { data: { id: 'ses_abc' } } } = {}) {
  return (args) => {
    if (args[1] === 'get' && args[2] === '/api/info') return okApi({ version: '2' });
    if (args[1] === 'post' && args[2] === '/api/session') return okApi(create);
    if (args[1] === 'post' && /\/generate$/.test(args[2])) return okApi({ data: { text } });
    if (args[1] === 'delete') return okApi({ data: true });
    return okApi({});
  };
}

// --- ollama backend (unchanged HTTP transport) ---------------------------------

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

// --- opencode V2 backend (opencode api CLI transport) --------------------------

test('opencode: probes, creates a session with the model, generates, then deletes', async () => {
  useOpencode();
  const calls = stubApi(happyApiHandler({ text: '  {"add":["X"],"remove":[]}  ' }));
  const complete = await backend.getCompleter();
  assert.strictEqual(typeof complete, 'function');
  const out = await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(out, '{"add":["X"],"remove":[]}');
  assert.strictEqual(calls.length, 4);
  assert.deepStrictEqual(calls[0].args, ['api', 'get', '/api/info']);
  assert.deepStrictEqual(calls[1].args, [
    'api',
    'post',
    '/api/session',
    '--data',
    JSON.stringify({ title: 'plant-note-getter reviewer', model: { providerID: 'test-provider', id: 'test-model' } })
  ]);
  assert.strictEqual(calls[2].args[0], 'api');
  assert.strictEqual(calls[2].args[1], 'post');
  assert.strictEqual(calls[2].args[2], '/api/session/ses_abc/generate');
  const prompt = dataArg(calls[2].args).prompt;
  assert.ok(prompt.startsWith('sys\n\nuser'));
  assert.ok(prompt.includes(JSON.stringify(SCHEMA)));
  assert.deepStrictEqual(calls[3].args, ['api', 'delete', '/api/session/ses_abc']);
});

test('opencode: omits the schema hint when no jsonSchema is passed', async () => {
  useOpencode();
  const calls = stubApi(happyApiHandler());
  const complete = await backend.getCompleter();
  await complete('sys', 'user');
  const prompt = dataArg(calls[2].args).prompt;
  assert.strictEqual(prompt, 'sys\n\nuser');
});

test('opencode: honors OPENCODE_SERVER_URL (trailing slash) and LLM_MODEL overrides', async () => {
  useOpencode();
  process.env.OPENCODE_SERVER_URL = 'http://127.0.0.1:4999/';
  process.env.LLM_MODEL = 'openrouter/anthropic/claude-3.5-sonnet';
  const calls = stubApi(happyApiHandler());
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.deepStrictEqual(calls[0].args, [
    'api',
    'get',
    '/api/info',
    '--server',
    'http://127.0.0.1:4999'
  ]);
  const createBody = dataArg(calls[1].args);
  assert.deepStrictEqual(createBody.model, {
    providerID: 'openrouter',
    id: 'anthropic/claude-3.5-sonnet'
  });
});

test('opencode: passes OPENCODE_SERVER_PASSWORD to the CLI as OPENCODE_PASSWORD', async () => {
  useOpencode();
  process.env.OPENCODE_SERVER_PASSWORD = 'secret';
  const calls = stubApi(happyApiHandler());
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  for (const call of calls) {
    assert.strictEqual(call.options.env.OPENCODE_PASSWORD, 'secret');
  }
});

test('opencode: no password means no OPENCODE_PASSWORD in the child env', async () => {
  useOpencode();
  const calls = stubApi(happyApiHandler());
  const complete = await backend.getCompleter();
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.deepStrictEqual(calls[0].options.env, {});
});

test('opencode: missing LLM_MODEL yields a null completer without calling the CLI', async () => {
  useOpencode();
  delete process.env.LLM_MODEL;
  backend.resetCompleter();
  const calls = stubApi(() => okApi({}));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 0);
});

test('opencode: LLM_MODEL without a provider slash yields a null completer', async () => {
  useOpencode();
  process.env.LLM_MODEL = 'qwen3:4b';
  backend.resetCompleter();
  const calls = stubApi(() => okApi({}));
  const warnings = [];
  console.warn = (msg) => warnings.push(String(msg));
  assert.strictEqual(await backend.getCompleter(), null);
  assert.strictEqual(calls.length, 0);
  assert.ok(warnings.some((w) => w.includes('provider/model')));
});

test('opencode: probe failure yields a null completer', async () => {
  useOpencode();
  stubApi(() => errApi({ _tag: 'UnauthorizedError', message: 'Authentication required' }, 'HTTP 401 Unauthorized'));
  assert.strictEqual(await backend.getCompleter(), null);
});

test('opencode: unreachable CLI yields a null completer', async () => {
  useOpencode();
  backend._runApi = async () => {
    throw new Error('spawn opencode ENOENT');
  };
  assert.strictEqual(await backend.getCompleter(), null);
});

test('opencode: generate HTTP error rejects the completion with the server message', async () => {
  useOpencode();
  stubApi((args) => {
    if (args[1] === 'get') return okApi({ version: '2' });
    if (args[1] === 'post' && args[2] === '/api/session') return okApi({ data: { id: 'ses_1' } });
    if (args[1] === 'delete') return okApi({ data: true });
    return errApi({ message: 'Model unavailable: test-provider/test-model' }, 'HTTP 400 Bad Request');
  });
  const complete = await backend.getCompleter();
  await assert.rejects(
    () => complete('sys', 'user', {}),
    /opencode api POST \/api\/session\/ses_1\/generate failed: Model unavailable/
  );
});

test('opencode: missing session id rejects the completion', async () => {
  useOpencode();
  stubApi((args) => {
    if (args[1] === 'get') return okApi({ version: '2' });
    if (args[1] === 'post' && args[2] === '/api/session') return okApi({ data: {} });
    return okApi({ data: { text: '{}' } });
  });
  const complete = await backend.getCompleter();
  await assert.rejects(() => complete('sys', 'user', {}), /returned no session id/);
});

test('opencode: missing generate text resolves to empty string', async () => {
  useOpencode();
  stubApi((args) => {
    if (args[1] === 'get') return okApi({ version: '2' });
    if (args[1] === 'post' && args[2] === '/api/session') return okApi({ data: { id: 'ses_1' } });
    if (args[1] === 'delete') return okApi({ data: true });
    return okApi({ data: {} });
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(await complete('sys', 'user', {}), '');
});

test('opencode: session delete failure is harmless', async () => {
  useOpencode();
  stubApi((args) => {
    if (args[1] === 'get') return okApi({ version: '2' });
    if (args[1] === 'post' && args[2] === '/api/session') return okApi({ data: { id: 'ses_1' } });
    if (args[1] === 'delete') return errApi({ message: 'boom' }, 'HTTP 500 Internal Server Error');
    return okApi({ data: { text: '{"add":[]}' } });
  });
  const complete = await backend.getCompleter();
  assert.strictEqual(await complete('sys', 'user', {}), '{"add":[]}');
});

test('opencode: completer records per-call stats with null cost/tokens', async () => {
  useOpencode();
  stubApi(happyApiHandler());
  const complete = await backend.getCompleter();
  assert.deepStrictEqual(complete.calls, []);
  await complete('sys', 'user', { jsonSchema: SCHEMA });
  assert.strictEqual(complete.calls.length, 1);
  assert.strictEqual(complete.calls[0].cost, null);
  assert.strictEqual(complete.calls[0].tokens, null);
  assert.strictEqual(typeof complete.calls[0].ms, 'number');
});

test('buildApiArgs pins --server only when OPENCODE_SERVER_URL is set', () => {
  delete process.env.OPENCODE_SERVER_URL;
  assert.deepStrictEqual(backend.buildApiArgs('get', '/api/info'), ['api', 'get', '/api/info']);
  process.env.OPENCODE_SERVER_URL = 'http://example.test:1234/';
  assert.deepStrictEqual(backend.buildApiArgs('get', '/api/info'), [
    'api',
    'get',
    '/api/info',
    '--server',
    'http://example.test:1234'
  ]);
  assert.deepStrictEqual(backend.buildApiArgs('post', '/api/session', { a: 1 }), [
    'api',
    'post',
    '/api/session',
    '--server',
    'http://example.test:1234',
    '--data',
    '{"a":1}'
  ]);
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
