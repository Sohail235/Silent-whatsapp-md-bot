/**
 * Nationality prediction via nationalize.io
 * Command: .nationalize <name>
 * Example: .nationalize nathaniel
 *
 * No API key required.
 */

const https = require('https');

const TIMEOUT_MS = 15000;
const MAX_SHOW = 5;

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode || 0, json: null }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
  });
}

function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  const s = name.trim();
  return /^[A-Za-z][A-Za-z '\-]{0,49}$/.test(s);
}

function toPercent(p) {
  if (typeof p !== 'number' || !isFinite(p)) return '-';
  return `${(p * 100).toFixed(1)}%`;
}

async function handleNationalize(sock, fromJid, m, rawName, sendWithChannel) {
  try {
    const name = (rawName || '').trim();
    if (!isValidName(name)) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .nationalize <name>\nExample: .nationalize nathaniel' }, { quoted: m });
      return;
    }

    const url = `https://api.nationalize.io/?name=${encodeURIComponent(name)}`;
    const { status, json } = await httpGetJson(url, { 'User-Agent': 'SilentBot/1.0' });

    if (status !== 200 || !json) {
      await sendWithChannel(sock, fromJid, { text: `❌ nationalize error (status ${status}).` }, { quoted: m });
      return;
    }

    const countries = Array.isArray(json.country) ? json.country : [];
    if (countries.length === 0) {
      await sendWithChannel(sock, fromJid, { text: `✅ No nationality prediction available for "${json.name || name}".` }, { quoted: m });
      return;
    }

    // Sort by probability desc and show top N
    countries.sort((a, b) => (b.probability || 0) - (a.probability || 0));
    const top = countries.slice(0, MAX_SHOW);

    const lines = [];
    lines.push('🏳️ Nationality Prediction (nationalize)');
    lines.push(`Name: ${json.name || name}`);
    lines.push('Top countries:');
    for (const c of top) {
      const code = c.country_id || '-';
      lines.push(`• ${code} — ${toPercent(c.probability)}`);
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch nationality prediction.' }, { quoted: m });
  }
}

module.exports = { handleNationalize };