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

const UPDATES_FILE_PATH = path.join(__dirname, '..', '.plant-note-updates.json');
const LABEL_MAP_PATH = path.join(__dirname, '..', 'label-map.json');

// Hybrid LLM reviewer (advisory second pass over Wikipedia extracts).
const LLM_ENABLED = process.env.LLM_ENABLED !== 'false';
const LLM_MODEL_ID = process.env.LLM_MODEL_ID || 'onnx-community/Qwen2.5-1.5B-Instruct';
const LLM_MAX_INPUT_CHARS = parseInt(process.env.LLM_MAX_INPUT_CHARS || '16000', 10);
const LLM_GATE = process.env.LLM_GATE || 'always'; // 'always' | 'auto'

// Review-gap tally log (catches later become red tests → regex patches).
const REVIEW_LOG_PATH = process.env.REVIEW_LOG_PATH || path.join(__dirname, '..', '.review-data', 'review-gaps.jsonl');
const REVIEW_LOG_ALL = process.env.REVIEW_LOG_ALL === 'true';

module.exports = {
  NOTE_ROOT,
  UPDATES_FILE_PATH,
  LABEL_MAP_PATH,
  LLM_ENABLED,
  LLM_MODEL_ID,
  LLM_MAX_INPUT_CHARS,
  LLM_GATE,
  REVIEW_LOG_PATH,
  REVIEW_LOG_ALL
};
