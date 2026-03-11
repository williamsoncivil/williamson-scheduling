/**
 * Buildertrend → Williamson Scheduling: File & Photo Import Script
 * ================================================================
 * Reusable for ANY job. Set JOB_ID and JOB_NAME below, then run:
 *   node scripts/bt-import-files.js
 *
 * Prerequisites:
 *   - Browser open and logged into buildertrend.net (openclaw browser profile)
 *   - CDP available on port 18800
 *   - .env has BLOB_READ_WRITE_TOKEN
 *
 * What it does:
 *   1. Fetches file list from Buildertrend's GetDirectoryDetails API
 *   2. Downloads each file using authenticated browser context (has session cookies)
 *   3. Uploads to Vercel Blob + registers in DB via /api/import-file
 *   4. Associates files with the correct job phase via associatedEntities
 *   5. Handles large files (>4MB) via @vercel/blob client upload
 */

const WebSocket = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/ws');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── CONFIG — change these per job ───────────────────────────────────────────
const JOB_ID   = 39325771;          // Buildertrend internal job ID
const JOB_NAME = '392 West Alder';  // Must match job name in Williamson Scheduling DB
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_TOKEN  = 'bt-import-2026-williamson';
const APP_HOST      = 'williamson-scheduling.vercel.app';
const B64_LIMIT     = 4 * 1024 * 1024; // 4MB threshold for large file path

// Load Vercel Blob token from .env
const envPath = path.join(__dirname, '../.env');
const BLOB_TOKEN = fs.readFileSync(envPath, 'utf8')
  .match(/BLOB_READ_WRITE_TOKEN=([^\n]+)/)?.[1]?.trim();

if (!BLOB_TOKEN) { console.error('No BLOB_READ_WRITE_TOKEN in .env'); process.exit(1); }
process.env.BLOB_READ_WRITE_TOKEN = BLOB_TOKEN;

const { upload } = require('@vercel/blob/client');

// ─── CDP helpers ──────────────────────────────────────────────────────────────

async function getPageId() {
  return new Promise((resolve, reject) => {
    https.get('http://127.0.0.1:18800/json'.replace('https', 'http'), res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const pages = JSON.parse(data);
          const bt = pages.find(p => p.url?.includes('buildertrend.net') && p.type === 'page');
          resolve(bt?.id || pages[0]?.id);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

let msgId = 1, ws;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Timeout: ${method}`)); } }, 120000);
  });
}

function evaluate(expr) {
  return send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 120000 });
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

function postToApp(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: IMPORT_TOKEN, jobName: JOB_NAME, ...payload });
    const req = https.request({
      hostname: APP_HOST, path: '/api/import-file', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadFile({ name, b64, contentType, phaseTitle }) {
  const buf = Buffer.from(b64, 'base64');
  const b64Len = b64.length;

  if (b64Len > B64_LIMIT) {
    // Large file: client-upload directly to Vercel Blob
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobPath = `williamson/${JOB_NAME.replace(/[^a-zA-Z0-9]/g, '-')}/${Date.now()}_${safeName}`;
    const blob = await upload(blobPath, buf, {
      access: 'public',
      contentType: contentType || 'application/pdf',
      handleUploadUrl: `https://${APP_HOST}/api/import-blob-token?token=${IMPORT_TOKEN}&jobName=${encodeURIComponent(JOB_NAME)}`,
    });
    return postToApp({ name, blobUrl: blob.url, contentType, phaseTitle });
  } else {
    return postToApp({ name, b64, contentType, phaseTitle });
  }
}

// ─── Fetch file list from Buildertrend ────────────────────────────────────────

const FILTERS = encodeURIComponent(JSON.stringify({
  "4": "",
  "10": JSON.stringify({ SelectedValue: 2147483647, StartDate: null, EndDate: null }),
  "12": JSON.stringify({ SelectedValue: 2147483647, StartDate: null, EndDate: null }),
}));

async function getFileList(folderId = -23000, associatedTypeId = 23, directoryType = 2) {
  const url = `/api/MediaFolders/GetDirectoryDetails?mediaType=1&folderId=${folderId}&associatedTypeId=${associatedTypeId}&directoryType=${directoryType}&jobId=${JOB_ID}&filters=${FILTERS}`;
  const result = await evaluate(`
    (async () => {
      const res = await fetch('${url}', { credentials: 'include', headers: { Accept: 'application/json' } });
      return await res.json();
    })()
  `);
  return result.result?.value?.data?.files || [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n📁 Buildertrend File Import`);
  console.log(`   Job: ${JOB_NAME} (id: ${JOB_ID})`);
  console.log(`   Target: https://${APP_HOST}\n`);

  // Connect to browser
  const pageId = await getPageId();
  if (!pageId) { console.error('No Buildertrend page found in browser'); process.exit(1); }
  console.log(`Browser page: ${pageId}`);

  const { createConnection } = require('net');
  ws = new WebSocket(`ws://127.0.0.1:18800/devtools/page/${pageId}`);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    } catch (e) {}
  });
  await send('Page.enable');
  console.log('Connected to browser ✅\n');

  // Navigate to attached files page to ensure job context is set
  await send('Page.navigate', { url: `https://buildertrend.net/app/Documents/AttachedFiles/-23000` });
  await new Promise(r => setTimeout(r, 5000));

  // Fetch file list
  console.log('Fetching file list...');
  const files = await getFileList();
  console.log(`Found ${files.length} files\n`);

  if (files.length === 0) {
    console.log('No files found. Check job ID and that the browser is logged in.');
    ws.close(); process.exit(0);
  }

  let uploaded = 0, failed = 0, skipped = 0;
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = file.title || file.fileName || `file-${i}.pdf`;
    const downloadUrl = file.downloadUrl;
    const contentType = `application/${file.extension || 'pdf'}`;
    const sizeKB = Math.round((file.sizeInBytes || 0) / 1024);

    // Extract phase name from associatedEntities
    const phaseTitle = file.associatedEntities?.[0]?.associatedEntityTitle || null;

    console.log(`[${i+1}/${files.length}] ${name} (${sizeKB}KB)${phaseTitle ? ` → phase: "${phaseTitle}"` : ''}`);

    if (!downloadUrl) { console.log('  ⚠ No download URL, skipping'); skipped++; continue; }

    // Download via browser (has auth cookies)
    const dlResult = await evaluate(`
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(downloadUrl)}, { credentials: 'include' });
          if (!res.ok) return { error: 'HTTP ' + res.status };
          const ct = res.headers.get('content-type') || 'application/pdf';
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.slice(i, i+8192));
          return { b64: btoa(binary), contentType: ct, size: bytes.length };
        } catch(e) { return { error: e.message }; }
      })()
    `);

    const dl = dlResult.result?.value;
    if (!dl?.b64) { console.log(`  ❌ Download failed: ${dl?.error}`); failed++; continue; }
    console.log(`  ⬇ Downloaded ${dl.size} bytes`);

    try {
      const result = await uploadFile({ name, b64: dl.b64, contentType: dl.contentType, phaseTitle });
      if (result.status === 201) {
        console.log(`  ✅ Uploaded → ${result.body?.url?.slice(0, 60)}...`);
        uploaded++;
        results.push({ name, phase: phaseTitle, url: result.body?.url });
      } else {
        console.log(`  ❌ Upload failed (${result.status}): ${JSON.stringify(result.body).slice(0, 100)}`);
        failed++;
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ ${uploaded} uploaded  ❌ ${failed} failed  ⚠ ${skipped} skipped`);
  console.log(`${'─'.repeat(50)}\n`);

  // Save results log
  const logPath = path.join(__dirname, `../bt-import-log-${JOB_ID}-${Date.now()}.json`);
  fs.writeFileSync(logPath, JSON.stringify({ jobId: JOB_ID, jobName: JOB_NAME, results }, null, 2));
  console.log(`Log saved: ${logPath}`);

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Fatal:', e.message); ws?.close(); process.exit(1); });
