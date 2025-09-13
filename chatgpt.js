/**
 * chatgpt.js — Chat via GitHub Models (OpenAI SDK) for Baileys bot
 *
 * Command: .gpt [model:model_id] <your prompt>
 *
 * Env:
 *   - GITHUB_TOKEN=ghp_xxx (required; GitHub PAT with access to GitHub Models)
 *   - CHATGPT_MODEL=openai/gpt-4o-mini (optional)
 *   - CHATGPT_SYSTEM=You are a helpful assistant. (optional)
 *   - CHATGPT_TEMPERATURE=0.7 (optional)
 *   - CHATGPT_MAX_TOKENS=800 (optional)
 *
 * Install: npm i openai
 */

require('dotenv').config();

const OpenAIImport = require('openai');
const OpenAI = OpenAIImport?.OpenAI || OpenAIImport?.default || OpenAIImport;

const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const DEFAULT_MODEL = (process.env.CHATGPT_MODEL || 'openai/gpt-4o-mini').trim();
const DEFAULT_SYSTEM = (process.env.CHATGPT_SYSTEM || 'You are a helpful assistant.').trim();
const DEFAULT_TEMPERATURE = parseFloat(process.env.CHATGPT_TEMPERATURE || '0.7');
const DEFAULT_MAX_TOKENS = parseInt(process.env.CHATGPT_MAX_TOKENS || '800', 10);

// Footer to append to every GPT reply
const SILENT_FOOTER = '\n\nMade with ♥️ by SILENT® https://t.me/Silent000666';

function buildClient() {
  return new OpenAI({
    baseURL: 'https://models.github.ai/inference',
    apiKey: GITHUB_TOKEN
  });
}

function parseArgs(raw) {
  const out = { model: DEFAULT_MODEL, prompt: String(raw || '').trim() };
  const m = out.prompt.match(/^\s*model:([^\s]+)\s+(.*)$/i);
  if (m) {
    out.model = m[1].trim();
    out.prompt = m[2].trim();
  }
  return out;
}

function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) chunks.push(str.slice(i, i + size));
  return chunks;
}

async function askChatGpt({
  prompt,
  model = DEFAULT_MODEL,
  system = DEFAULT_SYSTEM,
  temperature = DEFAULT_TEMPERATURE,
  maxTokens = DEFAULT_MAX_TOKENS
}) {
  if (!GITHUB_TOKEN) return { ok: false, reason: 'Missing GITHUB_TOKEN in .env' };
  if (!prompt || !prompt.trim()) return { ok: false, reason: 'Prompt is empty.' };

  let client;
  try {
    client = buildClient();
  } catch (e) {
    return { ok: false, reason: e?.message || 'Failed to initialize OpenAI client' };
  }

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      top_p: 1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt.trim() }
      ]
    });

    let text = (resp?.choices?.[0]?.message?.content || '').trim();
    if (!text) return { ok: false, reason: 'Empty response from model.' };

    // Always append the Silent footer
    text += SILENT_FOOTER;

    return { ok: true, data: { text, modelUsed: model } };
  } catch (e) {
    const status = e?.status || e?.response?.status;
    const msg = e?.message || e?.response?.data?.message || 'Request failed';
    if (status === 401) return { ok: false, reason: '401 Unauthorized — invalid/missing GITHUB_TOKEN or no access to GitHub Models.' };
    if (status === 403) return { ok: false, reason: '403 Forbidden — check org policy or token scopes.' };
    if (status === 429) return { ok: false, reason: '429 Rate limited — please retry later.' };
    return { ok: false, reason: `${status ? `HTTP ${status} — ` : ''}${msg}` };
  }
}

/**
 * WhatsApp handler for .gpt
 */
async function handleGpt(sock, fromJid, m, argsString = '', sendWithChannel) {
  const raw = String(argsString || '').trim();
  if (!raw) {
    const usage =
      '⚠️ Usage:\n' +
      '• .gpt <your prompt>\n' +
      '• .gpt model:openai/gpt-4o-mini <your prompt>';
    await sendWithChannel(sock, fromJid, { text: usage }, { quoted: m });
    return;
  }

  await sendWithChannel(sock, fromJid, { text: '⏳ Thinking...' }, { quoted: m });

  const { model, prompt } = parseArgs(raw);
  const res = await askChatGpt({ prompt, model });

  if (!res.ok) {
    await sendWithChannel(sock, fromJid, { text: `❌ ${res.reason}` }, { quoted: m });
    return;
  }

  const text = res.data.text;
  const parts = chunkString(text, 3500);
  for (const part of parts) {
    await sendWithChannel(sock, fromJid, { text: part }, { quoted: m });
  }
}

module.exports = {
  askChatGpt,
  handleGpt
};

  
  
      
 
    

