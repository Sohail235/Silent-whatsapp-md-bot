/**
 * cat.js — Random cat image command using TheCatAPI
 *
 * Features:
 * - .cat                     => random cat (JPG/PNG)
 * - .cat gif                 => random animated cat GIF
 * - .cat <breed>             => random cat for a breed (best-effort)
 * - .cat gif <breed>         => animated GIF filtered by breed (if available)
 *
 * Env (optional):
 * - THECATAPI_KEY            (from https://thecatapi.com/) increases rate limits
 * - CAT_TIMEOUT_MS=10000
 *
 * Exports:
 * - fetchCatImagePublic({ breedQuery?, gifOnly? })
 * - handleCat(sock, jid, m, argsString, sendWithChannel?)
 */

require('dotenv').config();
const axios = require('axios');

const THECAT_BASE = 'https://api.thecatapi.com/v1';
const TIMEOUT_MS = parseInt(process.env.CAT_TIMEOUT_MS || '10000', 10);
const API_KEY = (process.env.THECATAPI_KEY || '').trim();

const http = axios.create({
  baseURL: THECAT_BASE,
  timeout: TIMEOUT_MS,
  validateStatus: (s) => s >= 200 && s < 600
});

function makeHeaders() {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'SilentBot/1.0 (+https://github.com/Sohail235)'
  };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  return headers;
}

function isLikelyBreedId(s) {
  return /^[a-z]{3,5}$/.test(String(s || '').trim());
}

async function resolveBreedId(breedQuery) {
  if (!breedQuery) return null;
  const q = String(breedQuery).trim();
  if (!q) return null;

  if (isLikelyBreedId(q)) return q;

  const res = await http.get('/breeds/search', {
    headers: makeHeaders(),
    params: { q }
  });
  if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) return null;
  return res.data[0]?.id || null;
}

async function fetchCatImagePublic({ breedQuery = '', gifOnly = false } = {}) {
  try {
    let breedId = null;

    if (breedQuery) {
      try {
        breedId = await resolveBreedId(breedQuery);
      } catch {
        breedId = isLikelyBreedId(breedQuery) ? breedQuery : null;
      }
    }

    const params = {
      limit: 1,
      size: 'full',
      order: 'RANDOM',
      mime_types: gifOnly ? 'gif' : 'jpg,png'
    };
    if (breedId) params.breed_ids = breedId;

    const res = await http.get('/images/search', {
      headers: makeHeaders(),
      params
    });

    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) {
      return { ok: false, reason: `HTTP ${res.status} from TheCatAPI or no results` };
    }

    const it = res.data[0] || {};
    const url = it.url || '';
    if (!url) return { ok: false, reason: 'No image URL returned' };

    const breedMeta = Array.isArray(it.breeds) && it.breeds[0] ? it.breeds[0] : null;

    return {
      ok: true,
      data: {
        url,
        width: it.width || null,
        height: it.height || null,
        breed: breedMeta ? { id: breedMeta.id, name: breedMeta.name } : null,
        source: 'thecatapi',
        gif: /\.gif$/i.test(url)
      }
    };
  } catch (e) {
    return { ok: false, reason: e?.message || 'Failed to fetch cat image' };
  }
}

function buildCaption(payload, { gifOnly, breedQuery }) {
  const parts = ['🐱 Random Cat'];
  if (gifOnly) parts.push('(GIF)');
  if (payload?.breed?.name) parts.push(`• Breed: ${payload.breed.name}`);
  else if (breedQuery) parts.push(`• Breed: ${breedQuery} (best match)`);
  parts.push('• Source: 🩸ᏕᎥᏝᏋᏁᏖ ᏦᎥᏝᏝᏕ 🩸');
  return parts.join(' ');
}

/**
 * WhatsApp command handler
 * Usage: .cat | .cat gif | .cat <breed> | .cat gif <breed>
 */
async function handleCat(sock, fromJid, m, argsString = '', sendWithChannel) {
  const text = String(argsString || '').trim();

  // Parse flags and breed
  let gifOnly = false;
  let breedQuery = '';

  if (text.length > 0) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const rest = [];
    for (const t of tokens) {
      if (/^gif$/i.test(t)) gifOnly = true;
      else rest.push(t);
    }
    breedQuery = rest.join(' ');
  }

  try {
    const res = await fetchCatImagePublic({ breedQuery, gifOnly });
    if (!res.ok) {
      const msg = `❌ Could not fetch a cat image. ${res.reason || ''}`.trim();
      if (typeof sendWithChannel === 'function') {
        await sendWithChannel(sock, fromJid, { text: msg }, { quoted: m });
      } else {
        await sock.sendMessage(fromJid, { text: msg }, { quoted: m });
      }
      return;
    }

    const caption = buildCaption(res.data, { gifOnly, breedQuery });

    // Prefer image sending; if GIF and your stack supports video+gifPlayback, you can switch.
    const content = { image: { url: res.data.url }, caption };

    if (typeof sendWithChannel === 'function') {
      await sendWithChannel(sock, fromJid, content, { quoted: m });
    } else {
      await sock.sendMessage(fromJid, content, { quoted: m });
    }
  } catch {
    const msg = '❌ Failed to send cat image.';
    if (typeof sendWithChannel === 'function') {
      await sendWithChannel(sock, fromJid, { text: msg }, { quoted: m });
    } else {
      await sock.sendMessage(fromJid, { text: msg }, { quoted: m });
    }
  }
}

module.exports = {
  fetchCatImagePublic,
  handleCat
};