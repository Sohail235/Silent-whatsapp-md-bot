/**
 * Silent Bot — WhatsApp Bot (Baileys)
 * Full production-ready bot.js (single project focus)
 *
 * Major features:
 * - Privacy: .public, .private
 * - Anti-Delete controls: .antion, .antioff, .antistatus, .antidelete
 * - Owner-only block/unblock: .block, .unblock
 * - Utilities: .ping, .runtime (alias .uptime)
 * - Weather: .weather <city>
 * - JID Tools: .jidinfo, .extractjid, .linkjid
 * - Basic APIs: .ipme, .ipgeo <ip>, .randomuser <n>, .universities <country>, .whois <domain>, .agify <name>, .genderize <name>, .nationalize <name>
 * - Instagram: .insta (downloader), .iginfo <username>
 * - Media: .cat [gif] [breed], .s2i (sticker->image), .sm (sticker maker)
 * - AI:
 *    • .t2v [--dur 5|10] [prompt] — Freepik Kling v2 (reply to an image only; no URL). Uses freepik-keys.js rotation.
 *    • .pimg <prompt> — Pollinations image gen (prompt only; no flags; no API key)
 *    • .gpt — via chatgpt module (implementation-dependent)
 * - YouTube (query-based):
 *    • .ytv <query> — download MP4 (~360p) by search
 *    • .yta <query> — download MP3 128k by search
 *
 * Security:
 * - Secrets via .env. Freepik keys are handled by text2video.js + freepik-keys.js.
 *
 * Notes:
 * - This file expects companion modules present in project root (as previously provided).
 */

'use strict';

require('dotenv').config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const P = require('pino');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// ----- Project modules (ensure these files exist in your project) -----
const viewonceCommand = require('./viewonce');
const stealCommand = require('./steal');
const getppCommand = require('./getpp');
const checkCommand = require('./check');
const { getWeather } = require('./weather');
const instagramCommand = require('./instagram');
const antiDelete = require('./antidelete');
const ImageSearch = require('./image-search');
const IpInfo = require('./ipinfo');
const Ipify = require('./ipify');
const RandomUser = require('./randomuser');
const Universities = require('./universities');
const WhoisJson = require('./whoisjson');
const Agify = require('./agify');
const Genderize = require('./genderize');
const Nationalize = require('./nationalize');
const { bug } = require('./bug');
const { handleJidInfo, handleExtractJid } = require('./jid-extract');
const LinkJid = require('./link-jid');
const IgInfo = require('./iginfo');
const GroupList = require('./group-list');
const { handleCat } = require('./cat');

// Freepik T2V (reply-to-image only; uses key rotation internally)
const t2vMod = require('./text2video');
const handleT2V =
  (t2vMod && typeof t2vMod.handleT2V === 'function' && t2vMod.handleT2V) ||
  (typeof t2vMod === 'function' ? t2vMod : null) ||
  (t2vMod && typeof t2vMod.default === 'function' ? t2vMod.default : null);

// Pollinations image generation (prompt-only)
const polliMod = require('./pollinations');
const handlePolliImg =
  (polliMod && typeof polliMod.handlePolliImg === 'function' && polliMod.handlePolliImg) ||
  (typeof polliMod === 'function' ? polliMod : null) ||
  (polliMod && typeof polliMod.default === 'function' ? polliMod.default : null);

// YouTube (query-based)
const ytMod = require('./youtube');
const handleYTV = ytMod && typeof ytMod.handleYTV === 'function' ? ytMod.handleYTV : null;
const handleYTA = ytMod && typeof ytMod.handleYTA === 'function' ? ytMod.handleYTA : null;

// Freepik Mystic image gen (optional, if you use it)
let handleImg = null;
let handleImgStatus = null;
try {
  const freepikMod = require('./freepik');
  handleImg = freepikMod?.handleImg;
  handleImgStatus = freepikMod?.handleImgStatus;
} catch { /* optional */ }

// ----- Minimal, robust loaders for .s2i and .sm -----
let s2iCommand = null;
let smCommand = null;
let s2iLoadError = null;
let smLoadError = null;

(function loadS2I() {
  try {
    const mod = require('./s2i');
    s2iCommand = typeof mod === 'function' ? mod : (mod?.handleS2I || mod?.default || null);
  } catch (e1) {
    try {
      const mod = require('./s2i');
      s2iCommand = typeof mod === 'function' ? mod : (mod?.handleS2I || mod?.default || null);
    } catch (e2) {
      s2iLoadError = e2 || e1;
      s2iCommand = null;
    }
  }
})();

(function loadSM() {
  try {
    const mod = require('./sm');
    smCommand = typeof mod === 'function' ? mod : (mod?.handleSM || mod?.default || null);
  } catch (e1) {
    try {
      const mod = require('./sm');
      smCommand = typeof mod === 'function' ? mod : (mod?.handleSM || mod?.default || null);
    } catch (e2) {
      smLoadError = e2 || e1;
      smCommand = null;
    }
  }
})();

// ----- Config -----
const { OWNER_NUMBER, DEFAULT_PUBLIC } = require('./config');
let isPublic = DEFAULT_PUBLIC;
let autoStatusEnabled = true; // Toggle for auto-status viewing

// Channel attribution (forwarded via contextInfo)
const CHANNEL_JID = '120363418092205499@newsletter';
const CHANNEL_NAME = '🩸ᏕᎥᏝᏋᏁᏖ ᏦᎥᏝᏝᏕ🩸';

// Menu banner
const MENU_BANNER_URL = 'https://i.postimg.cc/pTvp1MkZ/Picsart-25-09-01-18-07-38-606.jpg';

// Runtime tracking
const BOT_START_TS = Date.now();

// ----- Helpers -----
function formatJid(number) {
  number = String(number || '').replace(/[^0-9]/g, '');
  return number + '@s.whatsapp.net';
}

function normalizeNumber(input) {
  if (!input) return '';
  return String(input).replace(/[^0-9]/g, '');
}

async function sendWithChannel(sock, jid, content, options = {}) {
  try {
    if (!content.contextInfo) content.contextInfo = {};
    content.contextInfo.forwardingScore = 1;
    content.contextInfo.isForwarded = true;
    content.contextInfo.forwardedNewsletterMessageInfo = {
      newsletterJid: CHANNEL_JID,
      newsletterName: CHANNEL_NAME,
      serverMessageId: -1
    };
    return await sock.sendMessage(jid, content, options);
  } catch (err) {
    console.error('sendWithChannel error:', err?.message || err);
  }
}

function buildMenu() {
  const now = new Date().toLocaleString();
  return [
    '╔══❀•°❀°•❀••°❀°•❀°══╗',
    '║  𓆩🩸 SILENT BOT 🩸𓆪  ║',
    '╚══❀•°❀°•❀••°❀°•❀°══╝',
    '༺❀༻—————༺❀༻',
    '✦ Utility',
    '• devil',
    '• .getpp',
    '• .check',
    '• void',
    '• .insta',
    '• .sm',
    '• .s2i',
    '༺❀༻—————༺❀༻',
    '✦ APIs',
    '• .imagesearch <query>',
    '• .ipme',
    '• .ipgeo',
    '• .randomuser',
    '• .universities',
    '• .whois',
    '• .agify',
    '• .genderize',
    '• .nationalize',
    '• .cat',
    '• .t2v',
    '• .pimg <prompt>',
    '• .ytv <query>',
    '• .yta <query>',
    '• .gpt',
    '• .img',
    '• .imgstatus',
    '༺❀༻—————༺❀༻',
    '✦ JID Tools',
    '• .jidinfo',
    '• .extractjid',
    '• .linkjid',
    '༺❀༻—————༺❀༻',
    '✦ Weather',
    '• .weather',
    '༺❀༻—————༺❀༻',
    '✦ Privacy',
    '• .public',
    '• .private',
    '• .darksilent',
    '• .grouplist',
    '༺❀༻—————༺❀༻',
    '✦ Auto-Status View', // Added section
    '• .autostatuson',   // Enable auto-status viewing
    '• .autostatusoff',  // Disable auto-status viewing
    '• .autostatus',     // Check status
    '༺❀༻—————༺❀༻',
    '✦ Anti-Delete',
    '• .antion',
    '• .antioff',
    '• .antistatus',
    '• .antidelete',
    '༺❀༻—————༺❀༻',
    `🕒 ${now}`
  ].join('\n');
}

function getBotNumberNormalized(sock) {
  try {
    const selfId = sock.user?.id || sock.user?.jid || sock.user || '';
    return normalizeNumber(selfId);
  } catch {
    return '';
  }
}

async function toWebpSticker(inputBuffer, kind /* 'image' | 'video' */) {
  const tmpDir = path.join(os.tmpdir(), 'wb-stickers');
  await fsp.mkdir(tmpDir, { recursive: true });

  const ts = Date.now();
  const inExt = kind === 'video' ? 'mp4' : 'png';
  const inputPath = path.join(tmpDir, `in_${ts}.${inExt}`);
  const outputPath = path.join(tmpDir, `out_${ts}.webp`);
  await fsp.writeFile(inputPath, inputBuffer);

  const baseScale = 'scale=512:512:force_original_aspect_ratio=decrease';
  const pad = 'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
  const videoFilter = `${baseScale},fps=15,format=rgba,${pad}`;
  const imageFilter = `${baseScale},format=rgba,${pad}`;

  const args = (kind === 'video')
    ? ['-y', '-i', inputPath, '-vf', videoFilter, '-vcodec', 'libwebp',
       '-loop', '0', '-preset', 'default', '-qscale', '75', '-an', outputPath]
    : ['-y', '-i', inputPath, '-vf', imageFilter, '-vcodec', 'libwebp',
       '-lossless', '1', '-qscale', '75', '-preset', 'picture', '-an', outputPath];

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (err) => err ? reject(err) : resolve());
  });

  const out = await fsp.readFile(outputPath);
  fsp.unlink(inputPath).catch(() => {});
  fsp.unlink(outputPath).catch(() => {});
  return out;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || parts.length) parts.push(`${h}h`);
  if (m || parts.length) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function formatNum(n) {
  if (n == null || isNaN(Number(n))) return '—';
  try { return Number(n).toLocaleString('en'); } catch { return String(n); }
}

// ----- Bot bootstrap -----
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: true
  });

  let ownerNumberNormalized = normalizeNumber(OWNER_NUMBER);
  let ownerJid = ownerNumberNormalized ? formatJid(ownerNumberNormalized) : null;

  // Anti-Delete controller
  const antiCtl = antiDelete(sock, sendWithChannel, { forwardToJid: ownerJid });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('connection closed, reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot connected!');
      try {
        const possibleId = sock.user?.id || sock.user?.jid || sock.user;
        if (!ownerNumberNormalized && possibleId) {
          ownerNumberNormalized = normalizeNumber(possibleId);
          ownerJid = ownerNumberNormalized ? formatJid(ownerNumberNormalized) : null;
          antiCtl.setForwardToJid(ownerJid || undefined);
          console.log('Owner (fallback) set to bot number:', ownerNumberNormalized);
        }
      } catch {}
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    const m = messages?.[0];
    if (!m?.message) return;

    try {
      const from = m.key.remoteJid;
      const senderJid = m.key.participant || m.key.remoteJid;
      const senderNumber = normalizeNumber(senderJid);
      const botNumberNow = getBotNumberNormalized(sock);

      // Owner logic
      const isOwner =
        (ownerNumberNormalized && senderNumber === ownerNumberNormalized) ||
        (botNumberNow && senderNumber === botNumberNow);

      // ---- Auto-Status Viewing ----
      if (type === 'notify' && autoStatusEnabled && m.message?.statusMessage) {
        if (!isPublic && !isOwner) return; // Respect privacy mode
        try {
          await sock.readMessages([m.key]);
          console.log(`Status from ${from} viewed.`);
          if (isOwner && ownerJid) {
            await sendWithChannel(sock, ownerJid, { text: `✅ Viewed status from ${from}` });
          }
        } catch (err) {
          console.error(`Failed to view status from ${from}:`, err);
          if (isOwner && ownerJid) {
            await sendWithChannel(sock, ownerJid, { text: `❌ Failed to view status from ${from}: ${err?.message || err}` });
          }
        }
        return;
      }

      const text =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.imageMessage?.caption ||
        m.message.videoMessage?.caption ||
        m.message.buttonsResponseMessage?.selectedButtonId ||
        m.message.templateButtonReplyMessage?.selectedId ||
        m.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        '';

      const txtLower = (text || '').trim().toLowerCase();

      // ---- Privacy mode switching (owner only) ----
      if (txtLower === '.public' || txtLower === '.private') {
        if (!isOwner) {
          await sendWithChannel(sock, from, { text: '❌ Only the owner can change the bot mode.' }, { quoted: m });
          return;
        }
        if (txtLower === '.public') {
          isPublic = true;
          await sendWithChannel(sock, from, { text: '✅ Bot is now Public (everyone can use commands).' }, { quoted: m });
        } else {
          isPublic = false;
          await sendWithChannel(sock, from, { text: '🔒 Bot is now Private (only owner can use commands).' }, { quoted: m });
        }
        return;
      }

      // ---- Anti-Delete toggles (owner, in owner DM) ----
      if (
        txtLower === '.antion' ||
        txtLower === '.antioff' ||
        txtLower === '.antistatus' ||
        txtLower.startsWith('.antidelete')
      ) {
        if (!isOwner) {
          await sendWithChannel(sock, from, { text: '❌ Only the owner can toggle Anti-Delete.' }, { quoted: m });
          return;
        }
        if (!ownerJid) ownerJid = ownerNumberNormalized ? formatJid(ownerNumberNormalized) : (botNumberNow ? formatJid(botNumberNow) : null);
        if (!ownerJid || from !== ownerJid) {
          await sendWithChannel(sock, from, { text: '🔒 Use this command in your private chat with the bot ("You" chat).' }, { quoted: m });
          return;
        }

        let action = '';
        if (txtLower === '.antion') action = 'on';
        else if (txtLower === '.antioff') action = 'off';
        else if (txtLower === '.antistatus') action = 'status';
        else {
          const parts = txtLower.split(/\s+/);
          action = parts[1] || 'status';
        }

        antiCtl.setForwardToJid(ownerJid);

        if (action === 'on') {
          antiCtl.enable();
          await sendWithChannel(sock, from, { text: '🧩 Anti-Delete ENABLED (global). Deleted messages will be forwarded here.' }, { quoted: m });
        } else if (action === 'off') {
          antiCtl.disable();
          await sendWithChannel(sock, from, { text: '🧩 Anti-Delete DISABLED' }, { quoted: m });
        } else {
          const state = antiCtl.isEnabled() ? 'ENABLED' : 'DISABLED';
          await sendWithChannel(sock, from, { text: `🧩 Anti-Delete status: ${state}\nForward target: ${ownerJid || '-'}` }, { quoted: m });
        }
        return;
      }

      // ---- Auto-Status View Commands (owner, in owner DM) ----
      if (
        txtLower === '.autostatuson' ||
        txtLower === '.autostatusoff' ||
        txtLower === '.autostatus'
      ) {
        if (!isOwner) {
          await sendWithChannel(sock, from, { text: '❌ Only the owner can toggle Auto-Status.' }, { quoted: m });
          return;
        }
        if (!ownerJid) ownerJid = ownerNumberNormalized ? formatJid(ownerNumberNormalized) : (botNumberNow ? formatJid(botNumberNow) : null);
        if (!ownerJid || from !== ownerJid) {
          await sendWithChannel(sock, from, { text: '🔒 Use this command in your private chat with the bot ("You" chat).' }, { quoted: m });
          return;
        }

        if (txtLower === '.autostatuson') {
          autoStatusEnabled = true;
          await sendWithChannel(sock, from, { text: '🧩 Auto-Status View ENABLED.' }, { quoted: m });
        } else if (txtLower === '.autostatusoff') {
          autoStatusEnabled = false;
          await sendWithChannel(sock, from, { text: '🧩 Auto-Status View DISABLED.' }, { quoted: m });
        } else {
          const state = autoStatusEnabled ? 'ENABLED' : 'DISABLED';
          await sendWithChannel(sock, from, { text: `🧩 Auto-Status View: ${state}` }, { quoted: m });
        }
        return;
      }

      // ---- Block / Unblock (owner only) ----
      if (txtLower.startsWith('.block') || txtLower.startsWith('.unblock')) {
        if (!isOwner) {
          await sendWithChannel(sock, from, { text: '❌ Only the owner can block/unblock users.' }, { quoted: m });
          return;
        }

        const isBlock = txtLower.startsWith('.block');
        const parts = text.trim().split(/\s+/);
        const argNum = parts[1] || '';

        let targetJid = null;
        const ctx = m.message?.extendedTextMessage?.contextInfo;
        if (ctx?.quotedMessage) targetJid = ctx.participant || null;

        if (!targetJid && argNum) {
          const num = normalizeNumber(argNum);
          if (num) targetJid = formatJid(num);
        }

        if (!targetJid && from.endsWith('@s.whatsapp.net')) {
          targetJid = from;
        }

        if (!targetJid || !targetJid.endsWith('@s.whatsapp.net')) {
          await sendWithChannel(
            sock,
            from,
            { text: `⚠️ Usage:\n• Reply to a user's message with ${isBlock ? '.block' : '.unblock'}\n• or ${isBlock ? '.block' : '.unblock'} <countrycodenumber>\nExample: ${isBlock ? '.block' : '.unblock'} 911234567890` },
            { quoted: m }
          );
          return;
        }

        try {
          if (typeof sock.updateBlockStatus !== 'function') {
            await sendWithChannel(sock, from, { text: '❌ Block API not available in this Baileys version.' }, { quoted: m });
            return;
          }
          await sock.updateBlockStatus(targetJid, isBlock ? 'block' : 'unblock');
          const num = targetJid.split('@')[0];
          await sendWithChannel(sock, from, { text: `${isBlock ? '🚫 Blocked' : '✅ Unblocked'}: ${num}` }, { quoted: m });
        } catch (e) {
          await sendWithChannel(sock, from, { text: `❌ Failed to ${isBlock ? 'block' : 'unblock'}: ${e?.message || e}` }, { quoted: m });
        }
        return;
      }

      // Enforce Private mode
      if (!isPublic && !isOwner) return;

      // ---- Utilities ----
      if (txtLower.startsWith('.ping')) {
        const t0 = Date.now();
        await sendWithChannel(sock, from, { text: '⏳ Pinging...' }, { quoted: m });
        const rtt = Date.now() - t0;
        const serverTime = new Date().toLocaleString();
        await sendWithChannel(sock, from, { text: `🏓 Pong!\n• Latency: ${rtt} ms\n• Server time: ${serverTime}` }, { quoted: m });
        return;
      }

      if (txtLower.startsWith('.runtime') || txtLower.startsWith('.uptime')) {
        const upMs = Date.now() - BOT_START_TS;
        const mu = process.memoryUsage();
        const toMB = (n) => (n / (1024 * 1024)).toFixed(1);
        const msg =
          `🕒 Uptime: ${formatDuration(upMs)}\n` +
          `🧠 Memory: RSS ${toMB(mu.rss)} MB | Heap ${toMB(mu.heapUsed)}/${toMB(mu.heapTotal)} MB\n` +
          `🖥 Node ${process.version} on ${process.platform} ${process.arch}`;
        await sendWithChannel(sock, from, { text: msg }, { quoted: m });
        return;
      }

      // ---- JID Tools ----
      if (text.startsWith('.jidinfo')) {
        await handleJidInfo(sock, from, m, sendWithChannel);
        return;
      }
      if (text.startsWith('.extractjid')) {
        await handleExtractJid(sock, from, m, sendWithChannel);
        return;
      }
      if (text.startsWith('.linkjid')) {
        const parts = text.split(' '); parts.shift();
        const argText = parts.join(' ');
        await LinkJid.handleLinkJid(sock, from, m, argText, sendWithChannel);
        return;
      }

      // ---- Basic APIs ----
      if (text.startsWith('.ipme')) {
        await Ipify.handleIpMe(sock, from, m, sendWithChannel);
        return;
      }
      if (text.startsWith('.ipgeo')) {
        const ip = text.trim().split(/\s+/)[1] || '';
        await IpInfo.handleIpGeo(sock, from, m, ip, sendWithChannel);
        return;
      }
      if (text.startsWith('.randomuser')) {
        const count = text.trim().split(/\s+/)[1] || '1';
        await RandomUser.handleRandomUser(sock, from, m, count, sendWithChannel);
        return;
      }
      if (text.startsWith('.universities')) {
        const parts = text.split(' '); parts.shift();
        const country = parts.join(' ');
        await Universities.handleUniversities(sock, from, m, country, sendWithChannel);
        return;
      }
      if (text.startsWith('.whois')) {
        const domain = text.trim().split(/\s+/)[1] || '';
        await WhoisJson.handleWhois(sock, from, m, domain, sendWithChannel);
        return;
      }
      if (text.startsWith('.agify')) {
        const parts = text.split(' '); parts.shift();
        const name = parts.join(' ');
        await Agify.handleAgify(sock, from, m, name, sendWithChannel);
        return;
      }
      if (text.startsWith('.genderize')) {
        const parts = text.split(' '); parts.shift();
        const name = parts.join(' ');
        await Genderize.handleGenderize(sock, from, m, name, sendWithChannel);
        return;
      }
      if (text.startsWith('.nationalize')) {
        const parts = text.split(' '); parts.shift();
        const name = parts.join(' ');
        await Nationalize.handleNationalize(sock, from, m, name, sendWithChannel);
        return;
      }

      // ---- Dark Silent Bug ----
      if (text.startsWith('.darksilent ')) {
        if (!isOwner) {
          await sendWithChannel(sock, from, { text: '❌ Only the owner can use this command.' }, { quoted: m });
          return;
        }

        const parts = text.trim().split(/\s+/);
        const targetNum = parts[1];
        if (!targetNum) {
          await sendWithChannel(sock, from, { text: '⚠️ Usage: .darksilent <countrycodenumber>\nExample: .darksilent 923001234567' }, { quoted: m });
          return;
        }

        const targetJid = targetNum.includes('@s.whatsapp.net') ? targetNum : `${targetNum}@s.whatsapp.net`;

        try {
          await sendWithChannel(sock, targetJid, { text: bug });
          await sendWithChannel(sock, from, { text: `✅ Bug message sent to ${targetNum}` }, { quoted: m });
        } catch (err) {
          console.error('Error sending darksilent:', err);
          await sendWithChannel(sock, from, { text: `❌ Failed to send: ${err?.message || err}` }, { quoted: m });
        }
        return;
      }

      // ---- Group list ----
      if (txtLower.startsWith('.grouplist')) {
        await GroupList(sock, from, m);
        return;
      }

      // ---- Cats ----
      if (text.startsWith('.cat')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        await sendWithChannel(sock, from, { text: '⏳ Fetching a cat for you...' }, { quoted: m });
        await handleCat(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- Text to Video (Freepik Kling v2; reply-to-image only) ----
      if (text.startsWith('.t2v')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        if (!handleT2V || typeof handleT2V !== 'function') {
          await sendWithChannel(sock, from, { text: '❌ T2V module not loaded.' }, { quoted: m });
          return;
        }
        await handleT2V(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- Pollinations image generation (prompt only) ----
      if (text.startsWith('.pimg')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        if (!handlePolliImg || typeof handlePolliImg !== 'function') {
          await sendWithChannel(sock, from, { text: '❌ Pollinations module not loaded.' }, { quoted: m });
          return;
        }
        await handlePolliImg(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- YouTube: video by query ----
      if (text.startsWith('.ytv')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        if (!handleYTV || typeof handleYTV !== 'function') {
          await sendWithChannel(sock, from, { text: '❌ YouTube module not loaded.' }, { quoted: m });
          return;
        }
        await handleYTV(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- YouTube: audio by query ----
      if (text.startsWith('.yta')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        if (!handleYTA || typeof handleYTA !== 'function') {
          await sendWithChannel(sock, from, { text: '❌ YouTube module not loaded.' }, { quoted: m });
          return;
        }
        await handleYTA(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- ChatGPT (GitHub Models / your implementation) ----
      if (text.startsWith('.gpt')) {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');

        const chatgptMod = require('./chatgpt');
        const gptHandler =
          (chatgptMod && typeof chatgptMod.handleGpt === 'function' && chatgptMod.handleGpt) ||
          (chatgptMod && chatgptMod.default && typeof chatgptMod.default.handleGpt === 'function' && chatgptMod.default.handleGpt) ||
          (typeof chatgptMod === 'function' ? chatgptMod : null);

        if (!gptHandler || typeof gptHandler !== 'function') {
          await sendWithChannel(sock, from, { text: '❌ GPT module not loaded.' }, { quoted: m });
          return;
        }
        await gptHandler(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- Freepik Mystic (.img / .imgstatus) ----
      if (text.startsWith('.imgstatus') && typeof handleImgStatus === 'function') {
        const parts = text.split(' '); parts.shift();
        const taskId = parts.join(' ').trim();
        await handleImgStatus(sock, from, m, taskId, sendWithChannel);
        return;
      }

      if (text.startsWith('.img') && typeof handleImg === 'function') {
        const parts = text.split(' '); parts.shift();
        const argsString = parts.join(' ');
        await handleImg(sock, from, m, argsString, sendWithChannel);
        return;
      }

      // ---- Existing media and utilities ----
      if (text.startsWith('devil')) {
        await stealCommand(sock, from, m, sendWithChannel);
        return;
      }

      if (text.startsWith('.getpp')) {
        const args = text.split(' ');
        if (args[1]) {
          const jid = formatJid(args[1]);
          await getppCommand(sock, from, m, jid, args[1], sendWithChannel);
        } else {
          await sendWithChannel(sock, from, { text: '⚠️ Usage: .getpp <number>' }, { quoted: m });
        }
        return;
      }

      if (text.startsWith('.check')) {
        let argsText = text.replace(/^\.check\s*/i, '');
        const numbers = argsText
          .split(/[\s,]+/)
          .map(n => n.trim())
          .filter(n => n.length > 0);
        await checkCommand(sock, from, m, numbers, sendWithChannel);
        return;
      }

      if (text.startsWith('void')) {
        await viewonceCommand(sock, from, m, sendWithChannel);
        return;
      }

      if (text.startsWith('.weather')) {
        const args = text.split(' '); args.shift();
        const city = args.join(' ');
        if (!city) {
          await sendWithChannel(sock, from, { text: '⚠️ Usage: .weather <city>' }, { quoted: m });
          return;
        }
        const result = await getWeather(city);
        if (!result) {
          await sendWithChannel(sock, from, { text: `❌ Could not fetch weather for "${city}"` }, { quoted: m });
          return;
        }
        const reply =
          `🌍 Weather in ${result.city}, ${result.country}\n\n` +
          `🌡 Temp: ${result.temp}°C (feels like ${result.feels_like}°C)\n` +
          `☁️ Condition: ${result.condition}\n` +
          `💧 Humidity: ${result.humidity}%\n` +
          `💨 Wind: ${result.wind} m/s`;
        await sendWithChannel(sock, from, { text: reply }, { quoted: m });
        return;
      }

      // Instagram downloader
      if (text.startsWith('.insta')) {
        await instagramCommand(sock, from, m, sendWithChannel);
        return;
      }

      // Instagram public info — ack + timeout + direct send
      if (text.startsWith('.iginfo')) {
        const parts = text.trim().split(/\s+/);
        const username = (parts[1] || '').replace(/^@/, '');
        if (!username) {
          await sendWithChannel(sock, from, { text: '⚠️ Usage: .iginfo <username>\nExample: .iginfo instagram' }, { quoted: m });
          return;
        }

        await sendWithChannel(sock, from, { text: `⏳ Fetching IG info for @${username}...` }, { quoted: m });

        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: 'Timeout (network/proxy blocked)' }), 20000)
        );

        let res;
        try {
          res = await Promise.race([IgInfo.fetchIgInfoPublic(username), timeout]);
        } catch (e) {
          res = { ok: false, reason: e?.message || 'Unhandled error' };
        }

        if (!res || !res.ok) {
          await sendWithChannel(sock, from, { text: `❌ ${res?.reason || 'Failed to fetch profile.'}` }, { quoted: m });
          return;
        }

        const d = res.data || {};
        const lines = [
          '╔══❀•°❀°•❀══╗',
          '║   𓆩🩸 IG INFO 🩸𓆪   ║',
          '╚══❀•°❀°•❀══╝',
          `• Username: @${d.username || username}`,
          d.full_name ? `• Name: ${d.full_name}` : null,
          `• Verified: ${d.is_verified === true ? '🔵 Verified' : d.is_verified === false ? '✖️ Not Verified' : '—'}`,
          `• Followers: ${formatNum(d.followers_count)}`,
          `• Following: ${formatNum(d.follows_count)}`,
          `• Posts: ${formatNum(d.media_count)}`,
          res.source ? `• Source: ${res.source}` : null
        ].filter(Boolean);

        const caption = lines.join('\n');

        if (d.profile_picture_url) {
          await sendWithChannel(sock, from, { image: { url: d.profile_picture_url }, caption }, { quoted: m });
        } else {
          await sendWithChannel(sock, from, { text: caption }, { quoted: m });
        }
        return;
      }

      // ---- .s2i (Sticker to Image) ----
      if (text.startsWith('.s2i')) {
        if (!s2iCommand) {
          await sendWithChannel(
            sock, from,
            { text: `❌ S2I module not loaded.${s2iLoadError ? `\nDebug: ${s2iLoadError.message || s2iLoadError}` : ''}` },
            { quoted: m }
          );
          return;
        }
        await s2iCommand(sock, from, m, sendWithChannel);
        return;
      }

      // ---- .sm (Sticker Maker) ----
      if (text.startsWith('.sm')) {
        if (!smCommand) {
          await sendWithChannel(
            sock, from,
            { text: `❌ SM module not loaded.${smLoadError ? `\nDebug: ${smLoadError.message || smLoadError}` : ''}` },
            { quoted: m }
          );
          return;
        }
        await smCommand(sock, from, m, sendWithChannel);
        return;
      }

      // ---- Image Search ----
      if (text.startsWith('.imagesearch')) {
        const parts = text.trim().split(/\s+/);
        parts.shift();
        const query = parts.join(' ');
        if (!query) {
          await sendWithChannel(sock, from, { text: '⚠️ Usage: .imagesearch <query>' }, { quoted: m });
          return;
        }

        try {
          await ImageSearch.handleImageSearch(sock, from, m, query, sendWithChannel);
        } catch (err) {
          await sendWithChannel(sock, from, { text: `❌ Image search failed: ${err?.message || err}` }, { quoted: m });
        }
        return;
      }

      // ---- Help / Menu ----
      if (text.startsWith('.silent') || text.startsWith('Abdullah')) {
        await sendWithChannel(sock, from, { image: { url: MENU_BANNER_URL }, caption: buildMenu() }, { quoted: m });
        return;
      }
    } catch (err) {
      console.error('messages.upsert handler error:', err?.stack || err);
      try {
        const from = m.key.remoteJid;
        await sendWithChannel(sock, from, { text: `❌ Error: ${err?.message || 'Unexpected error'}` }, { quoted: m });
      } catch {}
    }
  });
}

// ----- Graceful shutdown and error logs -----
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('❌ Uncaught Exception:', e));
process.on('unhandledRejection', (reason, p) => console.error('❌ Unhandled Rejection at:', p, 'reason:', reason));

// ----- Start bot -----
startBot();