/**
 * Pwned Passwords (no API key required) for Baileys bots
 *
 * Commands:
 *  - .pwnd <password>         -> Check a single password (Owner DM only). Also supports reply-to text.
 *  - .pwndhash <sha1-hex>     -> Check a SHA1 hash directly (safe to expose; no plaintext).
 *  - .pwndlist                -> Reply to a multi-line message/text; checks up to MAX_BATCH items (Owner DM only).
 *
 * Privacy & Security:
 *  - Never logs or echoes plaintext passwords.
 *  - Uses k-anonymity "range" API with Add-Padding to minimize inference risk.
 *  - Caches prefix responses to reduce network calls and rate pressure.
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const USER_AGENT = 'WhatsAppBot-Pwned/1.0 (+https://haveibeenpwned.com/Passwords)';
const RANGE_BASE = 'https://api.pwnedpasswords.com/range/';
const REQUEST_TIMEOUT_MS = 15000;

const MAX_BATCH = 50;     // Max lines for .pwndlist (sane safety limit)
const MAX_LINE_LEN = 256; // Ignore ultra-long lines

// Simple TTL LRU-ish cache for range results keyed by prefix
class RangeCache {
  constructor(maxEntries = 512, ttlMs = 60 * 60 * 1000) {
    this.max = maxEntries;
    this.ttl = ttlMs;
    this.map = new Map(); // prefix -> { at, data: Map<suffix,count> }
  }
  get(prefix) {
    const rec = this.map.get(prefix);
    if (!rec) return null;
    if (Date.now() - rec.at > this.ttl) {
      this.map.delete(prefix);
      return null;
    }
    // touch for recency
    this.map.delete(prefix);
    this.map.set(prefix, rec);
    return rec.data;
  }
  set(prefix, data) {
    if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value;
      if (firstKey) this.map.delete(firstKey);
    }
    this.map.set(prefix, { at: Date.now(), data });
  }
}

const rangeCache = new RangeCache();

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, { headers }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode || 0, text: buf.toString('utf8') });
        });
      });
      req.on('error', reject);
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('Request timeout'));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function sha1Upper(s) {
  return crypto.createHash('sha1').update(s, 'utf8').digest('hex').toUpperCase();
}

function isHex40(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{40}$/.test(s);
}

function maskPassword(pw) {
  if (!pw) return '';
  const len = Math.min(pw.length, 8);
  return '*'.repeat(len);
}

function parseQuotedText(m) {
  const q = m?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return '';
  return (q.conversation || q.extendedTextMessage?.text || '').trim();
}

async function fetchRange(prefix) {
  // Try cache first
  const cached = rangeCache.get(prefix);
  if (cached) return cached;

  const url = RANGE_BASE + prefix;
  const headers = { 'User-Agent': USER_AGENT, 'Add-Padding': 'true' };
  const { status, text } = await httpGet(url, headers);

  if (status !== 200) {
    const err = new Error(`range API status ${status}`);
    err.status = status;
    throw err;
  }

  // Parse lines: SUFFIX:COUNT
  const map = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const [suf, cnt] = t.split(':');
    if (suf && cnt) {
      const c = parseInt(cnt, 10);
      if (Number.isFinite(c)) map.set(suf, c);
    }
  }

  rangeCache.set(prefix, map);
  return map;
}

async function checkSha1Hex(sha1HexUpper) {
  const prefix = sha1HexUpper.slice(0, 5);
  const suffix = sha1HexUpper.slice(5);
  const table = await fetchRange(prefix);
  const count = table.get(suffix) || 0;
  return count;
}

// Command handlers

async function handlePwnd(sock, fromJid, m, argsStr, isOwner, isOwnerDm, sendWithChannel) {
  try {
    if (!isOwner || !isOwnerDm) {
      await sendWithChannel(sock, fromJid, { text: '🔒 Use .pwnd only in owner DM.' }, { quoted: m });
      return;
    }

    const direct = (argsStr || '').trim();
    const fromReply = parseQuotedText(m);
    const password = direct || fromReply;

    if (!password) {
      await sendWithChannel(
        sock,
        fromJid,
        { text: '⚠️ Usage: .pwnd <password>\nOr reply to a message that contains the password.' },
        { quoted: m }
      );
      return;
    }

    const sha1 = sha1Upper(password);
    const count = await checkSha1Hex(sha1);

    const masked = maskPassword(password);
    if (count > 0) {
      await sendWithChannel(
        sock,
        fromJid,
        { text: `⚠️ Password appears in known breaches ${count.toLocaleString()} times.\nSecret: ${masked}\nAdvice: Change it everywhere and enable 2FA.` },
        { quoted: m }
      );
    } else {
      await sendWithChannel(
        sock,
        fromJid,
        { text: `✅ Not found in the Pwned Passwords corpus.\nSecret: ${masked}\nStill use a unique password + 2FA.` },
        { quoted: m }
      );
    }
  } catch (err) {
    console.error('pwnd error:', err?.message || err);
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to check password. Try again later.' }, { quoted: m });
  }
}

async function handlePwndHash(sock, fromJid, m, sha1Candidate, sendWithChannel) {
  try {
    const hex = (sha1Candidate || '').trim();
    if (!isHex40(hex)) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Usage: .pwndhash <sha1-hex>\nExample: .pwndhash 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8' }, { quoted: m });
      return;
    }
    const upper = hex.toUpperCase();
    const count = await checkSha1Hex(upper);
    if (count > 0) {
      await sendWithChannel(sock, fromJid, { text: `⚠️ Hash found ${count.toLocaleString()} times in Pwned Passwords.` }, { quoted: m });
    } else {
      await sendWithChannel(sock, fromJid, { text: '✅ Hash not found in Pwned Passwords.' }, { quoted: m });
    }
  } catch (err) {
    console.error('pwndhash error:', err?.message || err);
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to check hash. Try again later.' }, { quoted: m });
  }
}

function extractLinesFromMessage(m) {
  // Try quoted message first, then self
  const q = m?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const body = q
    ? (q.conversation || q.extendedTextMessage?.text || '')
    : (m.message?.conversation || m.message?.extendedTextMessage?.text || '');
  return (body || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function handlePwndList(sock, fromJid, m, isOwner, isOwnerDm, sendWithChannel) {
  try {
    if (!isOwner || !isOwnerDm) {
      await sendWithChannel(sock, fromJid, { text: '🔒 Use .pwndlist only in owner DM (reply to multi-line text).' }, { quoted: m });
      return;
    }

    const lines = extractLinesFromMessage(m)
      .filter(l => l.length > 0 && l.length <= MAX_LINE_LEN)
      .slice(0, MAX_BATCH);

    if (!lines.length) {
      await sendWithChannel(
        sock,
        fromJid,
        { text: `⚠️ Reply to a multi-line message (one password per line).\nLimit: ${MAX_BATCH} lines.` },
        { quoted: m }
      );
      return;
    }

    await sendWithChannel(sock, fromJid, { text: `⏳ Checking ${lines.length} passwords...` }, { quoted: m });

    let found = 0;
    let notFound = 0;

    const items = lines.map((pw, idx) => {
      const sha1 = sha1Upper(pw);
      return { idx, sha1, masked: maskPassword(pw) };
    });

    // Do in small batches to avoid bursts
    const BATCH_SIZE = 5;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      await Promise.all(
        chunk.map(async (it) => {
          const c = await checkSha1Hex(it.sha1);
          it.count = c;
          if (c > 0) found++; else notFound++;
        })
      );
    }

    const sampleHits = items.filter(i => i.count > 0).slice(0, 10)
      .map(i => `- ${i.masked} → ${i.count.toLocaleString()}x`).join('\n');
    const sampleMiss = items.filter(i => !i.count).slice(0, 10)
      .map(i => `- ${i.masked}`).join('\n');

    const parts = [];
    parts.push(`🛡 Pwned Passwords Batch`);
    parts.push(`Total: ${items.length}`);
    parts.push(`Found: ${found} • Not Found: ${notFound}`);
    if (sampleHits) parts.push(`\nExamples (found):\n${sampleHits}`);
    if (sampleMiss) parts.push(`\nExamples (not found):\n${sampleMiss}`);

    await sendWithChannel(sock, fromJid, { text: parts.join('\n') }, { quoted: m });
  } catch (err) {
    console.error('pwndlist error:', err?.message || err);
    await sendWithChannel(sock, fromJid, { text: '❌ Batch check failed. Try again later.' }, { quoted: m });
  }
}

module.exports = {
  handlePwnd,
  handlePwndHash,
  handlePwndList
};