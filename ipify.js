/**
 * Public IP via api.ipify.org
 * Command: .ipme
 */

const https = require('https');
const TIMEOUT_MS = 15000;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {}, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
  });
}

async function handleIpMe(sock, fromJid, m, sendWithChannel) {
  try {
    const { status, text } = await httpGet('https://api.ipify.org/?format=json');
    if (status !== 200) {
      await sendWithChannel(sock, fromJid, { text: `❌ ipify error (status ${status}).` }, { quoted: m });
      return;
    }
    let data = {};
    try { data = JSON.parse(text); } catch {}
    const ip = data.ip || 'unknown';
    await sendWithChannel(sock, fromJid, { text: `🧭 Public IP: ${ip}` }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch public IP.' }, { quoted: m });
  }
}

module.exports = { handleIpMe };