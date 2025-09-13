/**
 * iginfo.js — Instagram public profile info (tokenless)
 *
 * What it does (best effort, no login/token):
 * - Fetches public profile info for a target username by calling Instagram's web endpoint first.
 * - Falls back to parsing the public profile HTML (meta tags) when the API is blocked.
 *
 * Returns (when available):
 * - profile_picture_url (HD if available)
 * - followers_count
 * - follows_count (following)
 * - media_count (posts)
 * - is_verified
 * - username
 * - full_name
 * - external_url
 *
 * Notes
 * - This uses publicly-available web data and can break if Instagram changes the structure.
 * - Some regions or IPs may get rate-limited or require cookies. We set headers to mimic a browser.
 * - No sensitive or private data is accessed.
 *
 * Bot wiring (in your bot.js):
 *   const IgInfo = require('./iginfo');
 *   ...
 *   if (text.startsWith('.iginfo')) {
 *     const parts = text.split(/\s+/);
 *     parts.shift();
 *     const username = (parts[0] || '').replace(/^@/, '');
 *     await IgInfo.handleIgInfo(sock, from, m, username, sendWithChannel);
 *     return;
 *   }
 */

const axios = require('axios');

const IG_WEB_PROFILE_INFO_URL = 'https://www.instagram.com/api/v1/users/web_profile_info/?username=';
const IG_PROFILE_PAGE_URL = 'https://www.instagram.com/';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Known public Web App ID used by instagram.com web client; helps some regions
const IG_WEB_APP_ID = '936619743392459';

const http = axios.create({
  timeout: 15000,
  // No baseURL so we can hit both endpoints as needed
  validateStatus: (s) => s >= 200 && s < 500
});

function sanitizeUsername(u) {
  if (!u) return '';
  const clean = String(u).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(clean)) return '';
  return clean;
}

function formatNumber(n) {
  if (n == null || isNaN(Number(n))) return '-';
  try {
    return Number(n).toLocaleString('en');
  } catch {
    return String(n);
  }
}

function parseShorthandNumber(txt) {
  if (!txt) return null;
  const s = String(txt).trim().replace(/,/g, '');
  const m = /^([\d.]+)\s*([kmb])?$/i.exec(s);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  const mult = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : 1;
  return Math.round(val * mult);
}

// Attempt 1: Official web JSON endpoint (no auth, but may be geo/IP gated)
async function fetchViaWebProfileInfo(username) {
  const url = `${IG_WEB_PROFILE_INFO_URL}${encodeURIComponent(username)}`;
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'application/json, text/plain, */*',
    'X-IG-App-ID': IG_WEB_APP_ID,
    // Some CDNs require a cookie to bypass first-visit gate
    'Cookie': 'ig_nrcb=1; dpr=1;'
  };
  const res = await http.get(url, { headers });
  if (res.status !== 200 || !res.data || !res.data.data || !res.data.data.user) {
    const reason = res.data?.message || `HTTP ${res.status}`;
    return { ok: false, reason };
  }

  const u = res.data.data.user;
  const data = {
    username: u.username || username,
    full_name: u.full_name || '',
    profile_picture_url: u.profile_pic_url_hd || u.profile_pic_url || '',
    followers_count: u.edge_followed_by?.count ?? null,
    follows_count: u.edge_follow?.count ?? null,
    media_count: u.edge_owner_to_timeline_media?.count ?? null,
    is_verified: Boolean(u.is_verified),
    external_url: u.external_url || ''
  };
  return { ok: true, source: 'api', data };
}

// Attempt 2: Parse HTML meta tags and inline JSON
async function fetchViaHtml(username) {
  const url = `${IG_PROFILE_PAGE_URL}${encodeURIComponent(username)}/`;
  const headers = {
    'User-Agent': DEFAULT_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cookie': 'ig_nrcb=1; dpr=1;'
  };
  const res = await http.get(url, { headers });
  if (res.status !== 200 || !res.data || typeof res.data !== 'string') {
    return { ok: false, reason: `Profile page fetch failed: HTTP ${res.status}` };
  }
  const html = res.data;

  // og:image for PFP
  const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  const profile_picture_url = ogImageMatch ? ogImageMatch[1] : '';

  // meta name="description" — contains "X Followers, Y Following, Z Posts"
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  let followers_count = null;
  let follows_count = null;
  let media_count = null;

  if (descMatch) {
    const desc = descMatch[1];
    // Try label-aware extraction
    const followersM = desc.match(/([\d.,]+)\s*Followers/i);
    const followingM = desc.match(/([\d.,]+)\s*Following/i);
    const postsM = desc.match(/([\d.,]+)\s*Posts?/i);
    if (followersM) followers_count = parseShorthandNumber(followersM[1]);
    if (followingM) follows_count = parseShorthandNumber(followingM[1]);
    if (postsM) media_count = parseShorthandNumber(postsM[1]);
  }

  // Username and name from og:title or meta tags
  let extractedUsername = username;
  const ogTitleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  // og:title often like: "Name (@username) • Instagram photos and videos"
  let full_name = '';
  if (ogTitleMatch) {
    const title = ogTitleMatch[1];
    const uMatch = title.match(/\(@([A-Za-z0-9._]+)\)/);
    if (uMatch) extractedUsername = uMatch[1];
    const nameMatch = title.match(/^(.+?)\s+\(@/);
    if (nameMatch) full_name = nameMatch[1].trim();
  }

  // is_verified hint from inline JSON if present
  let is_verified = null;
  const verMatch = html.match(/"is_verified"\s*:\s*(true|false)/i);
  if (verMatch) is_verified = verMatch[1].toLowerCase() === 'true';

  const data = {
    username: extractedUsername,
    full_name,
    profile_picture_url,
    followers_count,
    follows_count,
    media_count,
    is_verified,
    external_url: '' // not reliably available via meta without parsing full JSON
  };
  return { ok: true, source: 'html', data };
}

/**
 * Public function: fetchIgInfoPublic
 * - Tries the web JSON endpoint first.
 * - Falls back to HTML meta parsing.
 */
async function fetchIgInfoPublic(targetUsername) {
  const username = sanitizeUsername(targetUsername);
  if (!username) {
    return { ok: false, reason: 'Invalid username. Use letters, numbers, dots, and underscores only.' };
  }

  try {
    const apiRes = await fetchViaWebProfileInfo(username);
    if (apiRes.ok) return apiRes;
  } catch (e) {
    // ignore and fall back to HTML
  }

  try {
    const htmlRes = await fetchViaHtml(username);
    return htmlRes;
  } catch (e) {
    return { ok: false, reason: e?.message || 'Unknown error while parsing HTML.' };
  }
}

/**
 * WhatsApp handler for .iginfo <username>
 * Sends profile picture (if available) with a compact caption.
 */
async function handleIgInfo(sock, fromJid, m, rawUsername, sendWithChannel) {
  try {
    const username = sanitizeUsername(rawUsername);
    if (!username) {
      await sendWithChannel(sock, fromJid, { text: 'Usage: .iginfo <username>\nExample: .iginfo virat.kohli' }, { quoted: m });
      return;
    }

    const res = await fetchIgInfoPublic(username);
    if (!res.ok) {
      await sendWithChannel(sock, fromJid, { text: `❌ ${res.reason || 'Failed to fetch profile.'}` }, { quoted: m });
      return;
    }

    const d = res.data || {};
    const cap = [
      '╔══❀•°❀°•❀══╗',
      '║   𓆩🩸 IG INFO 🩸𓆪   ║',
      '╚══❀•°❀°•❀══╝',
      `• Username: @${d.username || username}`,
      d.full_name ? `• Name: ${d.full_name}` : null,
      `• Verified: ${d.is_verified === true ? '🔵 Verified' : d.is_verified === false ? '✖️ Not Verified' : '—'}`,
      `• Followers: ${d.followers_count != null ? formatNumber(d.followers_count) : '—'}`,
      `• Following: ${d.follows_count != null ? formatNumber(d.follows_count) : '—'}`,
      `• Posts: ${d.media_count != null ? formatNumber(d.media_count) : '—'}`
    ]
      .filter(Boolean)
      .join('\n');

    if (d.profile_picture_url) {
      await sendWithChannel(
        sock,
        fromJid,
        { image: { url: d.profile_picture_url }, caption: cap },
        { quoted: m }
      );
    } else {
      await sendWithChannel(sock, fromJid, { text: cap }, { quoted: m });
    }
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to fetch IG info.' }, { quoted: m });
  }
}

module.exports = {
  fetchIgInfoPublic,
  handleIgInfo
};