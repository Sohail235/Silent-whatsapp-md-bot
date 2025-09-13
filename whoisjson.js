/**
 * WHOIS lookup via whoisjson.com
 * Command: .whois <domain>
 * Note: API key is embedded as requested (no env var). Keep this private.
 */

const https = require('https');
const TIMEOUT_MS = 20000;

// Embedded API key (requested "no env"). Treat as secret.
const WHOISJSON_API_KEY = 'eb52ad31f63646d9f6b213691cb828cf4aeeba84daf5e5d2b8a8812a6e988eaf';

function isValidDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const d = domain.trim().toLowerCase();
  // Basic domain validation: label.label TLD with allowed chars
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d);
}

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

function safeJoin(arr) {
  return Array.isArray(arr) ? arr.filter(Boolean).join(', ') : '';
}

async function handleWhois(sock, fromJid, m, rawDomain, sendWithChannel) {
  try {
    const domain = (rawDomain || '').trim().toLowerCase();
    if (!isValidDomain(domain)) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .whois <domain>\nExample: .whois example.com' }, { quoted: m });
      return;
    }

    const url = `https://whoisjson.com/api/v1/whois?${new URLSearchParams({ domain }).toString()}`;
    const headers = { Authorization: `Token=${WHOISJSON_API_KEY}` };

    const { status, json } = await httpGetJson(url, headers);

    if (status === 401 || status === 403) {
      await sendWithChannel(sock, fromJid, { text: '❌ WHOIS auth failed. Check API key or plan.' }, { quoted: m });
      return;
    }
    if (status === 429) {
      await sendWithChannel(sock, fromJid, { text: '⏳ WHOIS rate limit exceeded. Try again later.' }, { quoted: m });
      return;
    }
    if (status !== 200 || !json) {
      await sendWithChannel(sock, fromJid, { text: `❌ WHOIS error (status ${status}).` }, { quoted: m });
      return;
    }

    const d = json || {};
    const registrar = d.registrarName || d.registrar || '-';
    const created = d.creationDate || d.createdDate || d.created || '-';
    const updated = d.updatedDate || d.updated || '-';
    const expires = d.registryExpiryDate || d.expiresDate || d.expirationDate || '-';
    const nameServers = safeJoin(d.nameServers || d.nameServer);
    const statuses = safeJoin(d.domainStatus || d.status);
    const registrant = d.registrant || d.registrantOrganization || d.registrantName || '-';

    const lines = [];
    lines.push('🔎 WHOIS');
    lines.push(`Domain: ${domain}`);
    lines.push(`Registrar: ${registrar}`);
    lines.push(`Created: ${created}`);
    lines.push(`Updated: ${updated}`);
    lines.push(`Expires: ${expires}`);
    if (registrant && registrant !== '-') lines.push(`Registrant: ${registrant}`);
    if (nameServers) lines.push(`NS: ${nameServers}`);
    if (statuses) lines.push(`Status: ${statuses}`);

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ WHOIS lookup failed.' }, { quoted: m });
  }
}

module.exports = { handleWhois };