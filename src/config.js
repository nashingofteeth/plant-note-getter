const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const NOTE_ROOT = process.env.NOTE_ROOT;

if (!NOTE_ROOT) {
  console.error('Error: NOTE_ROOT not found. Please set it in .env file');
  console.error('See .env.example for instructions');
  process.exit(1);
}

if (!fs.existsSync(NOTE_ROOT)) {
  console.error(`Error: NOTE_ROOT directory does not exist: ${NOTE_ROOT}`);
  process.exit(1);
}

const LABEL_MAP_PATH = path.join(__dirname, '..', 'label-map.json');

// End-of-Wikipedia LLM reviewer (advisory second pass; see src/llm-reviewer.js)
// through an external LLM backend. Runs by default when a model is
// configured; disabled by LLM_DISABLED=true, a --no-review CLI flag, or no
// LLM_MODEL. There is no default model.
//
// Two backends, selected by LLM_BACKEND (default 'opencode'):
//   - 'opencode': remote models via the opencode server API. LLM_MODEL is
//     'provider/model' (e.g. anthropic/claude-sonnet-4-5); credentials live
//     in opencode itself, never here. The server is auto-started when
//     unreachable unless OPENCODE_AUTOSTART=false.
//   - 'ollama': local Ollama daemon (LLM_SERVER_URL), LLM_MODEL is a daemon
//     model name.
const LLM_MODEL = process.env.LLM_MODEL || '';
const LLM_DISABLED =
  process.env.LLM_DISABLED === 'true' ||
  process.argv.includes('--no-review') ||
  !LLM_MODEL;
const LLM_ENABLED = !LLM_DISABLED;
const LLM_BACKEND = (process.env.LLM_BACKEND || 'opencode').toLowerCase();
const LLM_SERVER_URL = process.env.LLM_SERVER_URL || 'http://localhost:11434';
const OPENCODE_SERVER_URL = process.env.OPENCODE_SERVER_URL || 'http://localhost:4096';
const OPENCODE_AUTOSTART = process.env.OPENCODE_AUTOSTART !== 'false';
const LLM_MAX_INPUT_CHARS = parseInt(process.env.LLM_MAX_INPUT_CHARS || '16000', 10);

// Review-gap tally log (LLM corrections later become red tests → regex patches).
const REVIEW_LOG_PATH = process.env.REVIEW_LOG_PATH || path.join(__dirname, '..', '.review-data', 'review-gaps.jsonl');

module.exports = {
  NOTE_ROOT,
  LABEL_MAP_PATH,
  LLM_ENABLED,
  LLM_DISABLED,
  LLM_BACKEND,
  LLM_MODEL,
  LLM_SERVER_URL,
  OPENCODE_SERVER_URL,
  OPENCODE_AUTOSTART,
  LLM_MAX_INPUT_CHARS,
  REVIEW_LOG_PATH
};
