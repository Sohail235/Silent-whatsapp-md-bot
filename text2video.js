/**
 * Text/Image to Video via Freepik Kling v2
 *
 * Usage (reply-to-image only; URLs are ignored):
 *   - Reply to an image with:
 *       .t2v [--dur 5|10] [motion prompt...]
 *     Example: .t2v --dur 10 a cat moving his head
 *
 * Behavior:
 *   - If you reply to an image, it is required (no URL support).
 *   - Duration defaults to 5 seconds if not provided.
 *   - Starts an async generation task and polls until completion or timeout.
 *   - Sends the generated video back in chat using sendWithChannel for branding.
 *
 * Requirements:
 *   - Node 18+ (global fetch). If not available, this module will lazily import node-fetch.
 *   - Prefer setting FREEPIK_API_KEY in environment variables.
 *     Falls back to provided key if env var is missing.
 *
 * Signature expected by bot.js router:
 *   handleT2V(sock, chatId, m, argsString, sendWithChannel)
 */

'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const FREEPIK_API_KEY =
  process.env.FREEPIK_API_KEY ||
  'FPSXb0411ce914d42332ec36c010dbf42630'; // Fallback provided by user; prefer env var for security.

const API_BASE = 'https://api.freepik.com/v1/ai/image-to-video/kling-v2';

// ----- Helpers -----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argsString) {
  // Accepts: --dur=5|10 or --dur 5|10 or --duration
  let duration = '5';
  let prompt = (argsString || '').trim();

  const eq = prompt.match(/--dur(?:ation)?=(5|10)\b/i);
  if (eq) {
    duration = eq[1];
    prompt = prompt.replace(/--dur(?:ation)?=(5|10)\b/i, '').trim();
  } else {
    const sp = prompt.match(/--dur(?:ation)?\s+(5|10)\b/i);
    if (sp) {
      duration = sp[1];
      prompt = prompt.replace(/--dur(?:ation)?\s+(5|10)\b/i, '').trim();
    }
  }

  // Limit prompt to API max 2500 chars
  if (prompt.length > 2500) prompt = prompt.slice(0, 2500);
  return { duration, prompt };
}

async function getFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

async function bufferFromImageNode(imageMessageNode) {
  const stream = await downloadContentFromMessage(imageMessageNode, 'image');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function createTask({ imageBase64, duration, prompt }) {
  const f = await getFetch();

  const body = { image: imageBase64, duration: String(duration || '5') };
  if (prompt) body.prompt = prompt;

  const res = await f(API_BASE, {
    method: 'POST',
    headers: {
      'x-freepik-api-key': FREEPIK_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }

  if (!res.ok) {
    throw new Error(`Create failed (${res.status}): ${text || res.statusText}`);
  }

  const taskId = data?.data?.task_id || data?.data?.id || data?.task_id;
  if (!taskId) throw new Error('task_id missing in create response');
  return taskId;
}

async function getStatus(taskId) {
  const f = await getFetch();
  const url = `${API_BASE}/${encodeURIComponent(taskId)}`;
  const res = await f(url, {
    method: 'GET',
    headers: { 'x-freepik-api-key': FREEPIK_API_KEY }
  });

  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* ignore */ }

  if (!res.ok) {
    throw new Error(`Status failed (${res.status}): ${text || res.statusText}`);
  }

  const status = data?.data?.status || data?.status || '';
  const generated = data?.data?.generated || data?.generated || [];
  const error = data?.data?.error || data?.error;

  return { status, generated, error };
}

// ----- Public handler -----
module.exports.handleT2V = async function handleT2V(sock, chatId, m, argsString, sendWithChannel) {
  try {
    // Require a replied image or an inline image with caption .t2v
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    const repliedImage = ctx?.quotedMessage?.imageMessage || null;
    const inlineImage = m.message?.imageMessage || null;
    const imageNode = repliedImage || inlineImage;

    if (!imageNode) {
      await sendWithChannel(
        sock,
        chatId,
        { text: '⚠️ Reply to an image with .t2v [--dur 5|10] [optional motion prompt]. URLs are not accepted.' },
        { quoted: m }
      );
      return;
    }

    const { duration, prompt } = parseArgs(argsString);

    // Download and convert to Base64 (API requires base64 or public URL; we use base64)
    const imgBuffer = await bufferFromImageNode(imageNode);

    // Limit size to 10MB as per API doc
    if (imgBuffer.length > 10 * 1024 * 1024) {
      await sendWithChannel(sock, chatId, { text: '❌ Image too large. Please use an image up to 10MB.' }, { quoted: m });
      return;
    }

    const imageBase64 = imgBuffer.toString('base64');

    await sendWithChannel(
      sock,
      chatId,
      {
        text:
          `🎬 Creating video (${duration}s) with Freepik Kling v2...\n` +
          (prompt ? `📝 Motion prompt: ${prompt}\n` : '') +
          `🖼 Source: replied image\n` +
          `⏳ Please wait...`
      },
      { quoted: m }
    );

    // Create generation task
    const taskId = await createTask({ imageBase64, duration, prompt });

    // Poll for completion (~3 minutes max)
    const maxAttempts = 36;
    const delayMs = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { status, generated, error } = await getStatus(taskId);

      if (status === 'FAILED' || status === 'ERROR' || error) {
        await sendWithChannel(
          sock,
          chatId,
          { text: `❌ Generation failed. ${(error && (error.message || error)) || ''}` },
          { quoted: m }
        );
        return;
      }

      if (status === 'COMPLETED' || status === 'FINISHED' || status === 'SUCCESS') {
        const first = Array.isArray(generated) ? generated[0] : null;
        const videoUrl = typeof first === 'string' ? first : (first?.url || null);

        if (!videoUrl) {
          await sendWithChannel(sock, chatId, { text: '❌ Completed but no video URL returned.' }, { quoted: m });
          return;
        }

        await sendWithChannel(
          sock,
          chatId,
          { video: { url: videoUrl }, caption: `✅ Generated ${duration}s video${prompt ? ` • ${prompt}` : ''}` },
          { quoted: m }
        );
        return;
      }

      // IN_PROGRESS / QUEUED / CREATED
      await sleep(delayMs);
    }

    // Timeout
    await sendWithChannel(
      sock,
      chatId,
      { text: '⌛ Still generating (taking longer than expected). Please try again later.' },
      { quoted: m }
    );
  } catch (err) {
    await sendWithChannel(
      sock,
      chatId,
      { text: `❌ T2V error: ${err?.message || err}` },
      { quoted: m }
    );
  }
};