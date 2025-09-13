'use strict';
/**
 * Image Search for WhatsApp bot — no Bing key required
 *
 * Command:
 *   .imgsearch <query>
 *
 * Providers (first available in order is used; all are FREE to obtain or keyless):
 *   1) Unsplash (recommended, free key)      env: UNSPLASH_ACCESS_KEY
 *   2) Pexels (free key)                     env: PEXELS_API_KEY
 *   3) Pixabay (free key)                    env: PIXABAY_API_KEY
 *   4) DuckDuckGo Images (keyless fallback)  env: IMGSEARCH_ENABLE_DDG=true|false (default true)
 *
 * Optional env:
 *   - IMGSEARCH_PROVIDER_ORDER=unsplash,pexels,pixabay,ddg
 *   - IMGSEARCH_MAX_RESULTS=4
 *   - IMGSEARCH_TIMEOUT_MS=20000
 *   - IMGSEARCH_ENABLE_DDG=true
 *
 * Notes:
 *   - This module avoids Bing entirely.
 *   - DuckDuckGo fallback uses their public image endpoint i.js (undocumented), so it may break or rate-limit.
 *   - Each provider returns items normalized to: { title, url (image), thumb, source }
 */

const MAX_RESULTS = Math.max(1, Number(process.env.IMGSEARCH_MAX_RESULTS || 4));
const REQ_TIMEOUT_MS = Math.max(5000, Number(process.env.IMGSEARCH_TIMEOUT_MS || 20000));
const ENABLE_DDG = String(process.env.IMGSEARCH_ENABLE_DDG || 'true').toLowerCase() === 'true';
const PROVIDER_ORDER = (process.env.IMGSEARCH_PROVIDER_ORDER || 'unsplash,pexels,pixabay,ddg')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

function getUnsplashKey() {
  return (process.env.UNSPLASH_ACCESS_KEY || '').trim();
}
function getPexelsKey() {
  return (process.env.PEXELS_API_KEY || '').trim();
}
function getPixabayKey() {
  return (process.env.PIXABAY_API_KEY || '').trim();
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default || mod;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQ_TIMEOUT_MS) {
  const f = await getFetch();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const headers = { 'User-Agent': DEFAULT_UA, ...(options.headers || {}) };
    return await f(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function normalizeItems(items) {
  return (items || []).filter(Boolean).slice(0, MAX_RESULTS);
}

// ---------------- Unsplash (free key) ----------------
async function searchUnsplash(query) {
  const key = getUnsplashKey();
  if (!key) return null;

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(Math.min(30, MAX_RESULTS)));

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Client-ID ${key}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Unsplash error ${res.status}${text ? `: ${text.slice(0, 160)}...` : ''}`);
  }
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return normalizeItems(results.map(r => ({
    title: r.description || r.alt_description || 'Unsplash Photo',
    url: r.urls?.regular || r.urls?.full || r.urls?.small || '',
    thumb: r.urls?.small || r.urls?.thumb || '',
    source: r.links?.html || (r.user?.links?.html ? `${r.user.links.html}?utm_source=whatsapp-bot&utm_medium=referral` : '')
  })));
}

// ---------------- Pexels (free key) ----------------
async function searchPexels(query) {
  const key = getPexelsKey();
  if (!key) return null;

  const url = new URL('https://api.pexels.com/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', String(Math.min(80, MAX_RESULTS)));
  url.searchParams.set('page', '1');

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: key }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pexels error ${res.status}${text ? `: ${text.slice(0, 160)}...` : ''}`);
  }
  const json = await res.json();
  const photos = Array.isArray(json?.photos) ? json.photos : [];
  return normalizeItems(photos.map(p => ({
    title: p.alt || 'Pexels Photo',
    url: p.src?.large2x || p.src?.large || p.src?.original || p.src?.medium || '',
    thumb: p.src?.medium || p.src?.small || '',
    source: p.url || ''
  })));
}

// ---------------- Pixabay (free key) ----------------
async function searchPixabay(query) {
  const key = getPixabayKey();
  if (!key) return null;

  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query);
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('per_page', String(Math.min(200, MAX_RESULTS)));
  url.searchParams.set('safesearch', 'true');

  const res = await fetchWithTimeout(url.toString(), { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Pixabay error ${res.status}${text ? `: ${text.slice(0, 160)}...` : ''}`);
  }
  const json = await res.json();
  const hits = Array.isArray(json?.hits) ? json.hits : [];
  return normalizeItems(hits.map(h => ({
    title: h.tags || 'Pixabay Photo',
    url: h.largeImageURL || h.webformatURL || '',
    thumb: h.previewURL || h.webformatURL || '',
    source: `https://pixabay.com/photos/id-${h.id}/`
  })));
}

// ---------------- DuckDuckGo (keyless fallback) ----------------
async function ddgVqd(query) {
  // Load HTML to extract vqd token
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const res = await fetchWithTimeout(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml' }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`DDG vqd page error ${res.status}${t ? `: ${String(t).slice(0, 120)}...` : ''}`);
  }
  const text = await res.text();
  const m = text.match(/vqd='([^']+)'/) || text.match(/vqd=([0-9-]+)/);
  if (!m || !m[1]) throw new Error('DDG vqd token not found.');
  return m[1];
}

async function searchDuckDuckGo(query) {
  if (!ENABLE_DDG) return null;

  const vqd = await ddgVqd(query);
  const params = new URLSearchParams({
    l: 'en-us',
    o: 'json',
    q: query,
    vqd,
    f: ',,,',
    p: '1' // safe search moderate-ish (1 = moderate, -1 = off, 1 or 2 varies)
  });

  const url = `https://duckduckgo.com/i.js?${params.toString()}`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json, text/javascript, */*; q=0.01', Referer: 'https://duckduckgo.com/' }
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`DDG images error ${res.status}${t ? `: ${String(t).slice(0, 160)}...` : ''}`);
  }
  const json = await res.json();
  const results = Array.isArray(json?.results) ? json.results : [];
  return normalizeItems(results.map(r => ({
    title: r.title || r.source || 'Image result',
    url: r.image || '',
    thumb: r.thumbnail || '',
    source: r.url || r.source || ''
  })));
}

// ---------------- Public handler ----------------
/**
 * Handle .imgsearch <query>
 * @param {*} sock
 * @param {string} chatId
 * @param {*} m
 * @param {string} argsString
 * @param {(sock, chatId, content, options) => Promise<void>} sendWithChannel
 */
async function handleImageSearch(sock, chatId, m, argsString, sendWithChannel) {
  const query = (argsString || '').trim();
  if (!query) {
    await sendWithChannel(sock, chatId, { text: '⚠️ Usage: .imgsearch <query>\nExample: .imgsearch red sports car' }, { quoted: m });
    return;
  }

  await sendWithChannel(sock, chatId, { text: `🔎 Searching images for: ${query}` }, { quoted: m });

  // Provider runners
  const runners = {
    async unsplash() { return await searchUnsplash(query); },
    async pexels() { return await searchPexels(query); },
    async pixabay() { return await searchPixabay(query); },
    async ddg() { return await searchDuckDuckGo(query); }
  };

  // Build actual ordered provider list, removing ddg if disabled
  const order = PROVIDER_ORDER.filter(p => p !== 'ddg' || ENABLE_DDG);

  let lastErr = null;
  for (const provider of order) {
    try {
      if (!runners[provider]) continue;
      const items = await runners[provider]();
      if (items && items.length) {
        for (const item of items.slice(0, MAX_RESULTS)) {
          const caption = [
            item.title ? `🖼 ${item.title}` : null,
            item.source ? `🔗 ${item.source}` : null
          ].filter(Boolean).join('\n') || '🖼 Image result';
          const imageUrl = item.url || item.thumb;
          if (!imageUrl) continue;
          await sendWithChannel(sock, chatId, { image: { url: imageUrl }, caption }, { quoted: m });
        }
        return;
      }
    } catch (err) {
      lastErr = err;
      // try next provider
    }
  }

  if (lastErr) {
    await sendWithChannel(sock, chatId, { text: `❌ No provider returned results.\nLast error: ${lastErr?.message || lastErr}` }, { quoted: m });
  } else {
    await sendWithChannel(sock, chatId, { text: '❌ No images found and no providers configured.' }, { quoted: m });
  }
}

module.exports = { handleImageSearch };