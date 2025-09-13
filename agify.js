/**
 * Age prediction via agify.io
 * Command: .agify <name>
 * Example: .agify meelad
 *
 * No API key required.
 */

const https = require('https');

const TIMEOUT_MS = 15000;

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
  // Allow letters, spaces, hyphens, apostrophes; 1..50 chars
  return /^[A-Za-z][A-Za-z '\-]{0,49}$/.test(s);
}

async function handleAgify(sock, fromJid, m, rawName, sendWithChannel) {
  try {
    const name = (rawName || '').trim();
    if (!isValidName(name)) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .agify <name>\nExample: .agify meelad' }, { quoted: m });
      return;
    }

    const url = `https://api.agify.io/?name=${encodeURIComponent(name)}`;
    const { status, json } = await httpGetJson(url, { 'User-Agent': 'SilentBot/1.0' });

    if (status !== 200 || !json) {
      await sendWithChannel(sock, fromJid, { text: `❌ agify error (status ${status}).` }, { quoted: m });
      return;
    }

    const age = (typeof json.age === 'number') ? json.age : null;
    const count = (typeof json.count === 'number') ? json.count : 0;

    const lines = [];
    lines.push('👶 Age Prediction (agify)');
    lines.push(`Name: ${json.name || name}`);
    if (age !== null) {
      lines.push(`Age: ${age}`);
      lines.push(`Samples: ${count}`);
    } else {
      lines.push('No prediction available for this name.');
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch age prediction.' }, { quoted: m });
  }
}

module.exports = { handleAgify };