/**
 * Anti-Delete for Baileys v6+
 * - Caches all messages (text + media), including fromMe
 * - Restores deleted messages on REVOKE
 * - Detects REVOKE via both messages.upsert and messages.update
 * - Robust lookup: strict (jid|id|participant), loose (jid|id), and id-only keys
 * - Forwards recovered content to a configured JID (owner's "You" chat) when set
 *
 * Enable optional debug logs with: ANTI_DELETE_DEBUG=1
 */

const { downloadMediaMessage, getContentType } = require('@whiskeysockets/baileys');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CLEAN_INTERVAL_MS = 10 * 60 * 1000;   // 10 min
const MAX_CACHE = 5000;

const DEBUG = process.env.ANTI_DELETE_DEBUG === '1';
function dlog(...args) { if (DEBUG) console.log('[anti-delete]', ...args); }

function makeKeys(key) {
  const jid = key?.remoteJid || '';
  const id = key?.id || '';
  const participant = key?.participant || '';
  return {
    strict: `${jid}|${id}|${participant}`,
    loose: `${jid}|${id}`,
    idOnly: `${id}`,
  };
}

function resolveContentNode(message) {
  if (!message) return { node: null, type: null };

  if (message.ephemeralMessage) return resolveContentNode(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return resolveContentNode(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return resolveContentNode(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension) return resolveContentNode(message.viewOnceMessageV2Extension.message);

  const type = getContentType(message);
  return { node: message[type] ? message : message, type };
}

function extractText(containerMessage) {
  const { node } = resolveContentNode(containerMessage);
  if (!node) return '';

  if (node.conversation) return node.conversation;
  if (node.extendedTextMessage?.text) return node.extendedTextMessage.text;

  if (node.imageMessage?.caption) return node.imageMessage.caption;
  if (node.videoMessage?.caption) return node.videoMessage.caption;

  return '';
}

function detectMediaKind(containerMessage) {
  const { node } = resolveContentNode(containerMessage);
  if (!node) return null;

  if (node.imageMessage) return 'image';
  if (node.videoMessage) return 'video';
  if (node.stickerMessage) return 'sticker';
  if (node.audioMessage) return 'audio';
  if (node.documentMessage) return 'document';
  if (node.liveLocationMessage || node.locationMessage) return 'location';
  return null;
}

// Cache with triple index (strict + loose + id-only)
class MessageCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.strictMap = new Map(); // strictKey -> rec
    this.looseMap  = new Map(); // looseKey  -> rec
    this.idMap     = new Map(); // idOnly    -> rec
    this._interval = setInterval(() => this.cleanup(), CLEAN_INTERVAL_MS).unref?.();
  }

  add(key, container, authorJid) {
    const { strict, loose, idOnly } = makeKeys(key);

    // Soft cap protection
    const size = this.strictMap.size + this.looseMap.size + this.idMap.size;
    if (size > MAX_CACHE * 3) this.evictOldest(Math.ceil(MAX_CACHE * 0.3));

    const rec = { at: Date.now(), container, authorJid };
    this.strictMap.set(strict, rec);
    this.looseMap.set(loose, rec);
    if (idOnly) this.idMap.set(idOnly, rec);
    dlog('cached', { strict, loose, idOnly });
  }

  getByRevokedKey(key) {
    const { strict, loose, idOnly } = makeKeys(key);

    let rec = this.strictMap.get(strict);
    if (!rec) rec = this.looseMap.get(loose);
    if (!rec && idOnly) rec = this.idMap.get(idOnly);

    if (!rec) return null;

    if (Date.now() - rec.at > this.ttlMs) {
      this.strictMap.delete(strict);
      this.looseMap.delete(loose);
      if (idOnly) this.idMap.delete(idOnly);
      return null;
    }
    return rec;
  }

  evictOldest(count) {
    // Evict by oldest from strictMap and mirror to others (by object identity)
    const arr = [];
    for (const [k, v] of this.strictMap.entries()) arr.push({ k, v, t: v.at });
    arr.sort((a, b) => a.t - b.t);

    for (let i = 0; i < Math.min(count, arr.length); i++) {
      const { v } = arr[i];
      // Remove all indexes pointing to this record
      for (const [k, rv] of this.strictMap.entries()) if (rv === v) this.strictMap.delete(k);
      for (const [k, rv] of this.looseMap.entries()) if (rv === v) this.looseMap.delete(k);
      for (const [k, rv] of this.idMap.entries()) if (rv === v) this.idMap.delete(k);
    }
  }

  cleanup() {
    const now = Date.now();
    const expire = (map) => {
      for (const [k, v] of map.entries()) if (now - v.at > this.ttlMs) map.delete(k);
    };
    expire(this.strictMap);
    expire(this.looseMap);
    expire(this.idMap);
  }

  clear() {
    this.strictMap.clear();
    this.looseMap.clear();
    this.idMap.clear();
  }

  stop() {
    clearInterval(this._interval);
  }
}

/**
 * Attach anti-delete behavior to a Baileys socket.
 * @param {ReturnType<makeWASocket>} sock
 * @param {(sock, jid: string, content: any, options?: any) => Promise<any>} sendWithChannel
 * @param {{ ttlMs?: number, notifyText?: (deleterJid: string, chatId: string) => string, forwardToJid?: string }} [options]
 * @returns {{ enable: () => void, disable: () => void, isEnabled: () => boolean, stop: () => void, setForwardToJid: (jid: string) => void }}
 */
function attachAntiDelete(sock, sendWithChannel, options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new MessageCache(ttlMs);

  let enabled = true;
  let forwardToJid = options.forwardToJid || null;

  // Core revoke handler
  const handleRevoke = async (revokedKey, revokerJid) => {
    if (!enabled || !revokedKey) return;

    const chatId = revokedKey?.remoteJid;
    const deleterJid = revokerJid || revokedKey?.participant || revokedKey?.remoteJid || '';
    if (!chatId) return;

    const rec = cache.getByRevokedKey(revokedKey);
    const targetJid = forwardToJid || chatId;
    const notice = buildNoticeText(deleterJid, chatId, options.notifyText);

    if (!rec) {
      dlog('cache miss', { chatId, id: revokedKey?.id, participant: revokedKey?.participant });
      await safeSend(sendWithChannel, sock, targetJid, { text: `${notice}\n(Couldn't restore content)` });
      return;
    }

    // Text-only
    const caption = extractText(rec.container.message);
    const kind = detectMediaKind(rec.container.message);
    if (!kind) {
      const text = caption || '(no text content)';
      await safeSend(sendWithChannel, sock, targetJid, { text: `${notice}\n\n${text}` });
      return;
    }

    // Media path
    try {
      const buffer = await downloadMediaMessage(
        rec.container,
        'buffer',
        {},
        { logger: sock.logger, reuploadRequest: sock.updateMediaMessage }
      );
      const outgoing = buildOutgoingContent(kind, buffer, caption);
      await safeSend(sendWithChannel, sock, targetJid, { text: notice });
      await safeSend(sendWithChannel, sock, targetJid, outgoing);
    } catch (e) {
      dlog('media download failed', e?.message || e);
      await safeSend(sendWithChannel, sock, targetJid, { text: `${notice}\n(Media could not be restored)` });
    }
  };

  // Cache messages and also detect revokes arriving as an upsert
  const onUpsert = async ({ messages }) => {
    if (!messages?.length) return;

    for (const m of messages) {
      try {
        const pm = m.message?.protocolMessage;

        // If upsert itself is a revoke notification
        if (pm && pm.type === 0 && pm.key) {
          const revokerJid = m.key?.participant || m.key?.remoteJid || null; // actor reporting revoke
          dlog('revoke via upsert', { chat: m.key?.remoteJid, id: pm.key?.id, revoker: revokerJid });
          await handleRevoke(pm.key, revokerJid);
          continue;
        }

        // Cache everything (including fromMe) after enabled
        if (!enabled) continue;
        if (!m?.message) continue;

        cache.add(m.key, m, m.key?.participant || m.key?.remoteJid);
      } catch (e) {
        dlog('upsert error', e?.message || e);
      }
    }
  };

  // Also detect revokes via messages.update
  const onUpdate = async (updates) => {
    if (!updates?.length) return;
    for (const u of updates) {
      try {
        const pm = u.update?.message?.protocolMessage;
        if (pm && pm.type === 0 && pm.key) {
          dlog('revoke via update', { chat: pm.key?.remoteJid, id: pm.key?.id, participant: pm.key?.participant });
          await handleRevoke(pm.key, undefined);
        }
      } catch (e) {
        dlog('update error', e?.message || e);
      }
    }
  };

  sock.ev.on('messages.upsert', onUpsert);
  sock.ev.on('messages.update', onUpdate);

  const off = (evt, h) => {
    if (typeof sock.ev.off === 'function') return sock.ev.off(evt, h);
    if (typeof sock.ev.removeListener === 'function') return sock.ev.removeListener(evt, h);
  };

  return {
    enable() { enabled = true; dlog('enabled'); },
    disable() { enabled = false; dlog('disabled'); },
    isEnabled() { return enabled; },
    setForwardToJid(jid) { forwardToJid = jid || null; dlog('forwardToJid', forwardToJid); },
    stop() {
      off('messages.upsert', onUpsert);
      off('messages.update', onUpdate);
      cache.stop();
      cache.clear();
      dlog('stopped');
    }
  };
}

function buildNoticeText(deleterJid, chatId, customBuilder) {
  if (typeof customBuilder === 'function') {
    return customBuilder(deleterJid, chatId);
  }
  const time = new Date().toLocaleString();
  return `🧩 Anti-Delete (Global)
• Chat: ${chatId}
• Deleted by: ${(deleterJid || '').split('@')[0]}
• Time: ${time}`;
}

function buildOutgoingContent(kind, buffer, caption) {
  switch (kind) {
    case 'image':   return { image: buffer, caption: caption || '' };
    case 'video':   return { video: buffer, caption: caption || '' };
    case 'sticker': return { sticker: buffer };
    case 'audio':   return { audio: buffer };
    case 'document':return { document: buffer };
    case 'location':return { text: caption || '(location message)' };
    default:        return { text: caption || '(unsupported message type)' };
  }
}

async function safeSend(sendWithChannel, sock, jid, content, extra = {}) {
  try {
    return await sendWithChannel(sock, jid, content, extra);
  } catch {
    try {
      return await sock.sendMessage(jid, content, extra);
    } catch {}
  }
}

module.exports = attachAntiDelete;