/**
 * Random users via randomuser.me
 * Command: .randomuser [count]
 * Example: .randomuser 3   (1..5)
 */

const https = require('https');
const TIMEOUT_MS = 15000;
const MAX_RESULTS = 5;

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

function fmtUser(u) {
  const name = `${u.name?.title || ''} ${u.name?.first || ''} ${u.name?.last || ''}`.trim();
  const loc = `${u.location?.city || ''}, ${u.location?.state || ''}, ${u.location?.country || ''}`.replace(/(^[,\s]+|[,\s]+$)/g, '').replace(/\s+,/g, ',');
  return [
    `• ${name} (${u.gender || '-'}, ${u.nat || '-'})`,
    `  Email: ${u.email || '-'}`,
    `  Phone: ${u.phone || '-'}`,
    `  Location: ${loc || '-'}`,
  ].join('\n');
}

async function handleRandomUser(sock, fromJid, m, rawCount, sendWithChannel) {
  try {
    let n = parseInt((rawCount || '1').trim(), 10);
    if (!Number.isFinite(n) || n < 1) n = 1;
    if (n > MAX_RESULTS) n = MAX_RESULTS;

    const url = `https://randomuser.me/api/?results=${n}`;
    const { status, text } = await httpGet(url);
    if (status !== 200) {
      await sendWithChannel(sock, fromJid, { text: `❌ randomuser error (status ${status}).` }, { quoted: m });
      return;
    }
    let json = {};
    try { json = JSON.parse(text); } catch {}

    const users = Array.isArray(json.results) ? json.results : [];
    if (!users.length) {
      await sendWithChannel(sock, fromJid, { text: '❌ No users returned.' }, { quoted: m });
      return;
    }

    const lines = [`👤 Random User${users.length > 1 ? 's' : ''} (${users.length})`, ''];
    for (const u of users) lines.push(fmtUser(u));
    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch random user(s).' }, { quoted: m });
  }
}

module.exports = { handleRandomUser };