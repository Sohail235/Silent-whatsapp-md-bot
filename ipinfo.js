/**
 * IP Geo lookup via ipinfo.io
 * Command: .ipgeo <ip>
 * Example: .ipgeo 161.185.160.93
 */

const https = require('https');

const TIMEOUT_MS = 15000;

function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6 = /^(([0-9a-fA-F]{1,4}):){7}([0-9a-fA-F]{1,4})$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
  });
}

async function handleIpGeo(sock, fromJid, m, rawIp, sendWithChannel) {
  try {
    const ip = (rawIp || '').trim();
    if (!isValidIP(ip)) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .ipgeo <ip>\nExample: .ipgeo 161.185.160.93' }, { quoted: m });
      return;
    }

    const url = `https://ipinfo.io/${encodeURIComponent(ip)}/geo`;
    const { status, text } = await httpGet(url, { 'User-Agent': 'SilentBot/1.0' });

    if (status !== 200) {
      await sendWithChannel(sock, fromJid, { text: `❌ ipinfo error (status ${status}).` }, { quoted: m });
      return;
    }

    let data = {};
    try { data = JSON.parse(text); } catch {}

    const lines = [];
    lines.push('🌐 IP Geo');
    lines.push(`IP: ${data.ip || ip}`);
    if (data.city || data.region || data.country) {
      lines.push(`Location: ${[data.city, data.region, data.country].filter(Boolean).join(', ')}`);
    }
    if (data.loc) lines.push(`Coords: ${data.loc}`);
    if (data.org) lines.push(`Org: ${data.org}`);
    if (data.timezone) lines.push(`Timezone: ${data.timezone}`);

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch IP geo.' }, { quoted: m });
  }
}

module.exports = { handleIpGeo };