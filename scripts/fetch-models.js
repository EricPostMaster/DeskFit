#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function get(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const opts = { headers: { 'User-Agent': 'deskfit-fetcher' } };
    const req = lib.get(u, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        // follow redirect
        const next = new URL(res.headers.location, u).toString();
        resolve(get(next, maxRedirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed ${url} - status ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}

async function downloadModel(modelJsonUrl, outDir) {
  mkdirp(outDir);
  console.log('Downloading model.json from', modelJsonUrl);
  const modelBuf = await get(modelJsonUrl);
  const modelJson = JSON.parse(modelBuf.toString('utf8'));
  const modelPath = path.join(outDir, 'model.json');
  fs.writeFileSync(modelPath, JSON.stringify(modelJson, null, 2));
  console.log('Saved', modelPath);

  // Download weight shards
  const weightsManifest = modelJson.weightsManifest || [];
  const baseUrl = (() => {
    try {
      const u = new URL(modelJsonUrl);
      // base is directory containing model.json
      const parts = u.pathname.split('/');
      parts.pop();
      u.pathname = parts.join('/') + '/';
      return u.toString();
    } catch (e) {
      return '';
    }
  })();

  for (const group of weightsManifest) {
    for (const p of group.paths) {
      const remote = (p.startsWith('http://') || p.startsWith('https://')) ? p : new URL(p, baseUrl).toString();
      const filename = path.basename(p);
      const outPath = path.join(outDir, filename);
      console.log('Downloading shard', remote);
      const buf = await get(remote);
      fs.writeFileSync(outPath, buf);
      console.log('Saved', outPath);
    }
  }
  console.log('Model and shards downloaded to', outDir);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/fetch-models.js <MODEL_JSON_URL> [outDir]');
    process.exit(2);
  }
  const out = process.argv[3] || path.join(__dirname, '..', 'public', 'models', 'movenet');
  try {
    await downloadModel(arg, out);
  } catch (e) {
    console.error('Failed:', e.message || e);
    process.exit(1);
  }
}

main();
