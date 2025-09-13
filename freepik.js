/**
 * freepik.js — .img and .imgstatus commands (Freepik Mystic AI Image API)
 * - Robust task polling with multiple endpoint fallbacks
 * - Safer status/url extraction from varying response shapes
 * - Configurable poll duration and debug logging
 *
 * Commands:
 *   - .img [ar:16:9|9:16|1:1|3:4|4:3] [res:2k|4k] [model:realism] [hdr:0-100] [detail:0-100] [nsfw:false] <prompt>
 *   - .imgstatus <task_id>
 *
 * Env:
 *   - FREEPIK_API_KEY=...                 (required)
 *   - FREEPIK_TIMEOUT_MS=60000            (optional; POST timeout)
 *   - FREEPIK_POLL_MAX_MS=240000          (optional; total wait time while polling)
 *   - FREEPIK_POLL_INTERVAL_MS=3000       (optional; interval between polls)
 *   - FREEPIK_AUTOPOLL=true               (optional; disable with false)
 *   - FREEPIK_DEBUG=false                 (optional; true to log extra info)
 */

'use strict';

require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'https://api.freepik.com/v1/ai/mystic';
const API_KEY = (process.env.FREEPIK_API_KEY || '').trim();

const TIMEOUT_MS = parseInt(process.env.FREEPIK_TIMEOUT_MS || '60000', 10);
const POLL_MAX_MS = parseInt(process.env.FREEPIK_POLL_MAX_MS || '240000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.FREEPIK_POLL_INTERVAL_MS || '3000', 10);
const AUTOPOLL = String(process.env.FREEPIK_AUTOPOLL || 'true').toLowerCase() !== 'false';
const DEBUG = String(process.env.FREEPIK_DEBUG || 'false').toLowerCase() === 'true';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 600
});

function dbg(...a) {
  if (DEBUG) console.log('[FREEPIK]', ...a);
}

function makeHeaders() {
  return {
    'x-freepik-api-key': API_KEY,
    'Content-Type': 'application/json'
  };
}

const aspectMap = new Map([
  ['1:1', 'square_1_1'],
  ['16:9', 'landscape_16_9'],
  ['9:16', 'portrait_9_16'],
  ['3:4', 'portrait_3_4'],
  ['4:3', 'landscape_4_3']
]);

function toAspectValue(tok) {
  const v = (tok || '').trim();
  if (aspectMap.has(v)) return aspectMap.get(v);
  return aspectMap.get('1:1');
}

function normalizeResolution(v) {
  const s = String(v || '').toLowerCase();
  if (s === '4k') return '4k';
  if (s === '2k') return '2k';
  if (s === '1k') return '1k';
  return '2k';
}

function clampRange(val, min, max, fallback) {
  const n = Number(val);
  if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  return fallback;
}

function parseBooleanToken(v, fallback) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return fallback;
}

// BFS utilities
function bfsFindFirstByKey(obj, keyNamePredicate) {
  const queue = [obj];
  const seen = new Set();
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const k of Object.keys(node)) {
      try {
        if (keyNamePredicate(k)) return { key: k, value: node[k] };
      } catch {}
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') queue.push(v);
    }
  }
  return null;
}

function extractStatus(payload) {
  // Try common places first
  const status =
    payload?.data?.status ||
    payload?.status ||
    payload?.data?.data?.status ||
    payload?.data?.task?.status ||
    null;

  if (status) return String(status);

  // Fallback: BFS search for any "status" key
  const found = bfsFindFirstByKey(payload, (k) => typeof k === 'string' && k.toLowerCase() === 'status');
  return found ? String(found.value) : 'UNKNOWN';
}

function extractTaskId(payload) {
  return (
    payload?.data?.task_id ||
    payload?.task_id ||
    payload?.data?.data?.task_id ||
    payload?.data?.task?.id ||
    null
  );
}

function extractImageUrls(payload, max = 8) {
  const urls = [];
  const seen = new Set();
  const queue = [payload];

  while (queue.length && urls.length < max) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;
    seen.add(item);

    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item) && /\.(png|jpg|jpeg|webp)(\?|#|$)/i.test(item)) {
        urls.push(item);
      }
    } else if (Array.isArray(item)) {
      for (const x of item) queue.push(x);
    } else if (typeof item === 'object') {
      // push common fields
      for (const key of ['image', 'image_url', 'url']) {
        const val = item[key];
        if (typeof val === 'string' && /^https?:\/\//i.test(val)) {
          urls.push(val);
        }
      }
      for (const k of Object.keys(item)) queue.push(item[k]);
    }
  }

  return [...new Set(urls)].slice(0, max);
}

function isFinalStatus(status) {
  const s = String(status || '').toUpperCase();
  return ['DONE', 'COMPLETED', 'FINISHED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CANCELED', 'ERROR'].includes(s);
}

function isWorkingStatus(status) {
  const s = String(status || '').toUpperCase();
  return ['CREATED', 'QUEUED', 'PENDING', 'PROCESSING', 'RUNNING', 'IN_PROGRESS', 'STARTED'].includes(s);
}

// Try multiple endpoints to fetch a task by id
async function getTaskWithFallbacks(taskId) {
  const candidates = [
    `/tasks/${encodeURIComponent(taskId)}`,
    `/tasks?id=${encodeURIComponent(taskId)}`,
    `/${encodeURIComponent(taskId)}`,
    `/task/${encodeURIComponent(taskId)}`
  ];

  const headers = makeHeaders();
  let last = { tried: [], status: 0, data: null, endpoint: '', error: '' };

  for (const ep of candidates) {
    try {
      const res = await http.get(ep, { headers });
      dbg('GET', ep, '->', res.status);
      if (res.status >= 200 && res.status < 300) {
        return { status: res.status, data: res.data, endpoint: ep };
      }
      last = { ...last, status: res.status, data: res.data, endpoint: ep };
    } catch (e) {
      last = { ...last, status: 0, data: null, endpoint: ep, error: e?.message || 'Network error' };
      dbg('GET error for', ep, e?.message || e);
    }
  }

  return last; // return the last attempt info
}

async function pollTaskUntilDone(taskId, maxMs = POLL_MAX_MS, intervalMs = POLL_INTERVAL_MS) {
  const started = Date.now();
  let lastStatus = 'UNKNOWN';
  let lastHttp = 0;
  let lastEndpoint = '';
  let lastRaw = null;

  while (Date.now() - started < maxMs) {
    const r = await getTaskWithFallbacks(taskId);
    lastHttp = r.status;
    lastEndpoint = r.endpoint;
    lastRaw = r.data;

    const payload = r.data || {};
    const status = extractStatus(payload);
    lastStatus = status;

    const urls = extractImageUrls(payload, 8);
    if (urls.length > 0) {
      return { ok: true, status, urls, raw: payload, http: lastHttp, endpoint: lastEndpoint };
    }

    if (isFinalStatus(status)) {
      // final status but no urls
      return { ok: true, status, urls: [], raw: payload, http: lastHttp, endpoint: lastEndpoint };
    }

    if (!isWorkingStatus(status) && status !== 'UNKNOWN') {
      // Unknown non-working but not final -> keep trying a bit
      dbg('Non-working status:', status, 'continuing...');
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    ok: false,
    reason: `Timeout waiting for task ${taskId} (last status: ${lastStatus}; http: ${lastHttp}; endpoint: ${lastEndpoint || '-'})`,
    raw: lastRaw,
    http: lastHttp,
    endpoint: lastEndpoint
  };
}

async function generateImage({
  prompt,
  aspect = 'square_1_1',
  resolution = '4k',
  model = 'realism',
  hdr = 50, // 0..100
  creativeDetailing = 33, // 0..100
  filterNSFW = true // true means SAFE filtering on
}) {
  if (!API_KEY) return { ok: false, reason: 'Missing FREEPIK_API_KEY in .env' };
  if (!prompt || !prompt.trim()) return { ok: false, reason: 'Prompt cannot be empty.' };

  const body = {
    prompt: prompt.trim(),
    hdr: clampRange(hdr, 0, 100, 50),
    resolution: normalizeResolution(resolution),
    aspect_ratio: aspect,
    model,
    creative_detailing: clampRange(creativeDetailing, 0, 100, 33),
    engine: 'automatic',
    fixed_generation: false,
    filter_nsfw: !!filterNSFW
  };

  let res;
  try {
    res = await http.post('', body, { headers: makeHeaders() });
  } catch (e) {
    return { ok: false, reason: e?.message || 'Network error calling Freepik API' };
  }

  if (![200, 201, 202].includes(res.status)) {
    const apiMsg = (typeof res.data === 'object' && (res.data?.message || res.data?.error)) ? ` — ${res.data.message || res.data.error}` : '';
    return { ok: false, reason: `HTTP ${res.status} from Freepik API${apiMsg}` };
  }

  // 1) Immediate URLs
  const immediateUrls = extractImageUrls(res.data, 8);
  if (immediateUrls.length > 0) {
    return { ok: true, data: { urls: immediateUrls, raw: res.data } };
  }

  // 2) Async path
  const taskId = extractTaskId(res.data);
  const status = extractStatus(res.data) || 'UNKNOWN';
  if (!taskId) {
    return { ok: true, data: { urls: [], raw: res.data, status } };
  }

  if (!AUTOPOLL) {
    return { ok: true, data: { urls: [], raw: res.data, taskId, status } };
  }

  const polled = await pollTaskUntilDone(taskId, POLL_MAX_MS, POLL_INTERVAL_MS);
  if (!polled.ok) {
    return {
      ok: false,
      reason: polled.reason,
      taskId,
      http: polled.http,
      endpoint: polled.endpoint,
      raw: polled.raw
    };
  }

  return {
    ok: true,
    data: {
      urls: polled.urls || [],
      raw: polled.raw,
      taskId,
      status: polled.status,
      http: polled.http,
      endpoint: polled.endpoint
    }
  };
}

/**
 * WhatsApp handler for .img
 */
async function handleImg(sock, fromJid, m, argsString = '', sendWithChannel) {
  const raw = String(argsString || '').trim();

  // Parse flags
  let promptParts = [];
  let arToken = '1:1';
  let resToken = '4k';
  let model = 'realism';
  let hdr = 50;
  let detail = 33;
  let nsfw = false; // default safe => filter on

  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    const m1 = tok.match(/^ar:(.+)$/i);
    const m2 = tok.match(/^res:(.+)$/i);
    const m3 = tok.match(/^model:(.+)$/i);
    const m4 = tok.match(/^hdr:(\d{1,3})$/i);
    const m5 = tok.match(/^detail:(\d{1,3})$/i);
    const m6 = tok.match(/^nsfw:(.+)$/i);
    if (m1) arToken = m1[1];
    else if (m2) resToken = m2[1];
    else if (m3) model = m3[1];
    else if (m4) hdr = Number(m4[1]);
    else if (m5) detail = Number(m5[1]);
    else if (m6) nsfw = parseBooleanToken(m6[1], false);
    else promptParts.push(tok);
  }

  const prompt = promptParts.join(' ').trim();
  if (!prompt) {
    const usage =
      '⚠️ Usage:\n' +
      '• .img <prompt>\n' +
      '• .img ar:9:16 res:4k model:realism A samurai under cherry blossoms\n' +
      'Flags: ar:<1:1|16:9|9:16|3:4|4:3> res:<1k|2k|4k> model:<realism> hdr:<0-100> detail:<0-100> nsfw:<true|false>';
    await sendWithChannel(sock, fromJid, { text: usage }, { quoted: m });
    return;
  }

  const aspect = toAspectValue(arToken);
  const resolution = normalizeResolution(resToken);
  const filterNSFW = !nsfw;

  await sendWithChannel(
    sock,
    fromJid,
    { text: `🎨 Generating image...\n• AR: ${arToken} • Res: ${resolution} • Model: ${model}\n⏳ Will wait up to ${Math.floor(POLL_MAX_MS / 1000)}s if async.` },
    { quoted: m }
  );

  const res = await generateImage({
    prompt,
    aspect,
    resolution,
    model,
    hdr,
    creativeDetailing: detail,
    filterNSFW
  });

  if (!res.ok) {
    const tail = res.taskId
      ? `\nTask: ${res.taskId}\nEndpoint: ${res.endpoint || '-'}\nHTTP: ${res.http || '-'}`
      : '';
    const rawSnippet = res.raw ? `\n\nResponse (truncated):\n${JSON.stringify(res.raw, null, 2).slice(0, 1500)}` : '';
    await sendWithChannel(sock, fromJid, { text: `❌ ${res.reason}${tail}${rawSnippet}` }, { quoted: m });
    return;
  }

  const urls = res.data.urls || [];
  const caption =
    `🩸 ᏕᎥᏝᏋᏁᏖ ᏦᎥᏝᏝᏕ 🩸\n` +
    `• AR: ${arToken}\n` +
    `• Res: ${resolution}\n` +
    `• Model: ${model}\n` +
    `• Prompt: ${prompt}`;

  if (urls.length > 0) {
    for (let i = 0; i < Math.min(urls.length, 4); i++) {
      await sendWithChannel(sock, fromJid, { image: { url: urls[i] }, caption: i === 0 ? caption : undefined }, { quoted: m });
    }
  } else {
    const taskId = res.data.taskId || extractTaskId(res.data.raw) || '-';
    const status = res.data.status || extractStatus(res.data.raw) || 'UNKNOWN';
    const info =
      `ℹ️ No URLs yet.\n` +
      `• Task: ${taskId}\n` +
      `• Status: ${status}\n` +
      (res.data.endpoint ? `• Endpoint: ${res.data.endpoint}\n` : '') +
      (res.data.http ? `• HTTP: ${res.data.http}\n` : '') +
      `Use: .imgstatus ${taskId}`;
    const rawText = info + '\n\n' +
      'Response (truncated):\n' +
      JSON.stringify(res.data.raw, null, 2).slice(0, 1500);
    await sendWithChannel(sock, fromJid, { text: rawText }, { quoted: m });
  }
}

/**
 * WhatsApp handler for .imgstatus <task_id>
 */
async function handleImgStatus(sock, fromJid, m, argsString = '', sendWithChannel) {
  const taskId = String(argsString || '').trim();
  if (!taskId) {
    await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .imgstatus <task_id>' }, { quoted: m });
    return;
  }

  if (!API_KEY) {
    await sendWithChannel(sock, fromJid, { text: '❌ Missing FREEPIK_API_KEY in .env' }, { quoted: m });
    return;
  }

  const r = await getTaskWithFallbacks(taskId);
  const status = extractStatus(r.data || {});
  const urls = extractImageUrls(r.data || {}, 8);
  const header =
    `ℹ️ Task ${taskId}\n` +
    `• HTTP: ${r.status || '-'}\n` +
    `• Endpoint: ${r.endpoint || '-'}\n` +
    `• Status: ${status}`;

  if (urls.length > 0) {
    await sendWithChannel(sock, fromJid, { text: header }, { quoted: m });
    for (let i = 0; i < Math.min(urls.length, 4); i++) {
      await sendWithChannel(sock, fromJid, { image: { url: urls[i] }, caption: i === 0 ? `✅ ${taskId} — ${status}` : undefined }, { quoted: m });
    }
  } else {
    const rawSnippet = r.data ? `\n\nResponse (truncated):\n${JSON.stringify(r.data, null, 2).slice(0, 2000)}` : (r.error ? `\n\nError: ${r.error}` : '');
    await sendWithChannel(sock, fromJid, { text: header + rawSnippet }, { quoted: m });
  }
}

module.exports = {
  generateImage,
  handleImg,
  handleImgStatus
};