'use strict';
/**
 * Pollinations.AI image generation (.pimg)
 *
 * Command (prompt only; no flags):
 *   .pimg <prompt>
 *   - Or reply to a text message and send: .pimg
 *
 * Facts:
 * - No API key required.
 * - We fetch the image URL from Pollinations and send the image buffer back.
 * - Width/height/model/seed are fixed defaults (kept internal; not user configurable).
 *
 * Export shapes provided:
 * - Named:   const { handlePolliImg } = require('./pollinations')
 * - Default: const handlePolliImg = require('./pollinations')
 * - ESM-ish: const mod = require('./pollinations'); mod.default(...)
 */

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const DEFAULT_MODEL = 'flux';
const REQUEST_TIMEOUT_MS = 60000; // 60s safety timeout

// Use native fetch on Node 18+, otherwise lazy-load node-fetch
async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

function extractPromptFromReply(message) {
  const ctx = message?.message?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  if (!quoted) return '';

  return (
    quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption ||
    ''
  ).trim();
}

function resolvePrompt(argsString, message) {
  const inline = (argsString || '').trim();
  if (inline) return inline;
  return extractPromptFromReply(message);
}

function sanitizePrompt(prompt) {
  const p = String(prompt || '').trim();
  // Hard cap to avoid extremely long URLs
  if (p.length > 1000) return p.slice(0, 1000);
  return p;
}

function buildPollinationsUrl(prompt) {
  const seed = Math.floor(Math.random() * 10_000_000);
  const base = 'https://pollinations.ai/p/';
  // Example format: https://pollinations.ai/p/<encoded prompt>?width=1024&height=1024&seed=42&model=flux
  const url =
    `${base}${encodeURIComponent(prompt)}?` +
    `width=${DEFAULT_WIDTH}&height=${DEFAULT_HEIGHT}` +
    `&seed=${seed}&model=${encodeURIComponent(DEFAULT_MODEL)}`;
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const f = await getFetch();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await f(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Main handler used by bot.js
 */
async function handlePolliImg(sock, chatId, m, argsString, sendWithChannel) {
  try {
    const promptRaw = resolvePrompt(argsString, m);
    const prompt = sanitizePrompt(promptRaw);

    if (!prompt) {
      await sendWithChannel(
        sock,
        chatId,
        {
          text:
            '⚠️ Usage:\n' +
            '• .pimg <prompt>\n' +
            '• Or reply to a text prompt and send: .pimg\n' +
            'Example: .pimg newsreel; soviet aesthetics; b/w; realistic'
        },
        { quoted: m }
      );
      return;
    }

    const url = buildPollinationsUrl(prompt);

    // Acknowledge
    await sendWithChannel(
      sock,
      chatId,
      {
        text:
          '🎨 Generating image with Pollinations.AI...\n' +
          `📝 Prompt: ${prompt}\n` +
          `🧩 Model: ${DEFAULT_MODEL} • ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}\n` +
          '⏳ Please wait...'
      },
      { quoted: m }
    );

    // Perform the request
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'SilentBot/1.0 (+https://github.com/)',
        'Accept': 'image/*,application/octet-stream;q=0.9,*/*;q=0.8',
        'Referer': 'https://pollinations.ai/'
      },
      redirect: 'follow'
    });

    if (!res.ok) {
      // Try to capture response text for debugging (may be HTML)
      const text = await res.text().catch(() => '');
      const status = res.status;
      let hint = '';
      if (status === 403 || status === 429) {
        hint = ' (service is denying or rate-limiting requests right now, try again shortly)';
      }
      throw new Error(`Pollinations responded ${status}: ${text || res.statusText}${hint}`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    // Pollinations should return image/* for success, but accept octet-stream just in case
    if (!contentType.includes('image/') && !contentType.includes('application/octet-stream')) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Unexpected content-type: ${contentType || 'unknown'}${text ? ` • body: ${text.slice(0, 200)}...` : ''}`
      );
    }

    // Convert to Buffer and send
    const buffer = Buffer.from(await res.arrayBuffer());
    await sendWithChannel(
      sock,
      chatId,
      {
        image: buffer,
        caption: `✅ Generated via Pollinations • ${DEFAULT_MODEL} • ${DEFAULT_WIDTH}x${DEFAULT_HEIGHT}`
      },
      { quoted: m }
    );
  } catch (err) {
    const message =
      err?.name === 'AbortError'
        ? '❌ Pollinations timed out. Please try again.'
        : `❌ Pollinations error: ${err?.message || err}`;
    await sendWithChannel(sock, chatId, { text: message }, { quoted: m });
  }
}

// Export in multiple shapes for compatibility with various require styles
module.exports = handlePolliImg;                // default export is the handler function
module.exports.handlePolliImg = handlePolliImg; // named export
module.exports.default = handlePolliImg;        // ESM-style default