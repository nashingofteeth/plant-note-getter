const https = require('https');
const http = require('http');

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const GBIF_API = 'https://api.gbif.org/v1/species';
const WIKIPEDIA_MEDIAWIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'plant-note-getter/1.0.0 (https://github.com/nashingofteeth/plant-note-getter)';

let lastRequestTime = 0;
const MIN_INTERVAL = 600;

async function rateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

function fetchJSON(url, body = null, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const transport = isHttps ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: body ? 'POST' : 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const req = transport.request(options, (res) => {
      if (res.statusCode >= 400) {
        let errData = '';
        res.on('data', chunk => errData += chunk);
        res.on('end', () => {
          clearTimeout(timer);
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage} — ${errData.slice(0, 200)}`));
        });
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    if (body) {
      req.write(typeof body === 'string' ? body : new URLSearchParams(body).toString());
    }
    req.end();
  });
}

module.exports = { fetchJSON, rateLimit, WIKIDATA_API, SPARQL_ENDPOINT, GBIF_API, WIKIPEDIA_MEDIAWIKI_API };
