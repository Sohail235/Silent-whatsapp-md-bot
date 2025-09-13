/**
 * University search via Hipolabs
 * Command: .universities <country>
 * Example: .universities United States
 */

const http = require('http');
const https = require('https');
const TIMEOUT_MS = 15000;

function httpGetAny(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {}, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
  });
}

async function handleUniversities(sock, fromJid, m, rawCountry, sendWithChannel) {
  try {
    const country = (rawCountry || '').trim();
    if (!country) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .universities <country>\nExample: .universities United States' }, { quoted: m });
      return;
    }

    const url = `http://universities.hipolabs.com/search?country=${encodeURIComponent(country)}`;
    const { status, text } = await httpGetAny(url);
    if (status !== 200) {
      await sendWithChannel(sock, fromJid, { text: `❌ Hipolabs error (status ${status}).` }, { quoted: m });
      return;
    }
    let arr = [];
    try { arr = JSON.parse(text); } catch {}

    if (!Array.isArray(arr) || arr.length === 0) {
      await sendWithChannel(sock, fromJid, { text: `✅ No universities found for "${country}".` }, { quoted: m });
      return;
    }

    const top = arr.slice(0, 15);
    const lines = [`🎓 Universities in ${country} (showing ${top.length}/${arr.length})`, ''];
    for (const u of top) {
      const name = u.name || '-';
      const web = Array.isArray(u.web_pages) && u.web_pages.length ? u.web_pages[0] : '-';
      const state = u['state-province'] || '';
      lines.push(`• ${name}${state ? ` (${state})` : ''}`);
      lines.push(`  ${web}`);
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch universities.' }, { quoted: m });
  }
}

module.exports = { handleUniversities };