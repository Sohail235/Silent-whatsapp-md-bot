/**
 * JID extraction helpers and commands for Baileys WhatsApp bot.
 *
 * Commands:
 *  - .jidinfo
 *      • Shows current chat JID and its type (group/user/channel/broadcast)
 *      • Shows group metadata when in group
 *      • Shows forwarded channel (newsletter) JID when present
 *
 *  - .extractjid
 *      • Lists all identifiable JIDs from the message:
 *        chat JID, sender JID, quoted participant, mentions,
 *        forwarded newsletter (channel) JID and more.
 */

function getJidType(jid) {
  if (!jid || typeof jid !== 'string') return 'unknown';
  if (jid === 'status@broadcast') return 'status-broadcast';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@s.whatsapp.net')) return 'user';
  if (jid.endsWith('@newsletter')) return 'channel';
  if (jid.endsWith('@broadcast')) return 'broadcast';
  return 'unknown';
}

function phoneFromUserJid(jid) {
  if (!jid || !jid.endsWith('@s.whatsapp.net')) return '';
  return jid.replace('@s.whatsapp.net', '');
}

function safeContextInfo(message) {
  if (!message || typeof message !== 'object') return null;
  for (const k of Object.keys(message)) {
    const node = message[k];
    if (node && typeof node === 'object' && node.contextInfo) {
      return node.contextInfo;
    }
  }
  return null;
}

async function handleJidInfo(sock, fromJid, m, sendWithChannel) {
  try {
    const chatJid = fromJid;
    const chatType = getJidType(chatJid);
    const senderJid = m.key.participant || m.key.remoteJid;
    const senderPhone = phoneFromUserJid(senderJid);

    const lines = [];
    lines.push('🔎 JID Info');
    lines.push(`Chat JID: ${chatJid}`);
    lines.push(`Chat Type: ${chatType}`);
    if (senderJid) lines.push(`Sender JID: ${senderJid}${senderPhone ? ` (phone: ${senderPhone})` : ''}`);

    if (chatType === 'group') {
      try {
        const meta = await sock.groupMetadata(chatJid);
        const subject = meta?.subject || meta?.subjectName || '-';
        const owner = meta?.owner || meta?.subjectOwner || '';
        const participants = Array.isArray(meta?.participants) ? meta.participants.length : 0;
        lines.push(`Group Subject: ${subject}`);
        if (owner) lines.push(`Group Owner: ${owner}`);
        lines.push(`Participants: ${participants}`);
      } catch {
        lines.push('Group Metadata: (unavailable)');
      }
    }

    if (chatType === 'channel' && typeof sock.newsletterMetadata === 'function') {
      try {
        const nMeta = await sock.newsletterMetadata(chatJid);
        const title = nMeta?.name || nMeta?.title || '-';
        const state = nMeta?.state || '-';
        lines.push(`Channel Title: ${title}`);
        lines.push(`Channel State: ${state}`);
      } catch {
        lines.push('Channel Metadata: (unavailable)');
      }
    }

    const ci = safeContextInfo(m.message);
    const fwd = ci?.forwardedNewsletterMessageInfo;
    if (fwd?.newsletterJid) {
      lines.push(`Forwarded From Channel: ${fwd.newsletterJid}`);
      if (fwd.newsletterName) lines.push(`Forwarded Channel Name: ${fwd.newsletterName}`);
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to read JID info.' }, { quoted: m });
  }
}

async function handleExtractJid(sock, fromJid, m, sendWithChannel) {
  try {
    const list = [];
    const chatJid = fromJid;
    const senderJid = m.key.participant || m.key.remoteJid;

    const getJidTypeLocal = getJidType; // clarity for closures

    list.push({ label: 'chat', jid: chatJid, type: getJidTypeLocal(chatJid) });
    if (senderJid) list.push({ label: 'sender', jid: senderJid, type: getJidTypeLocal(senderJid) });

    const ci = safeContextInfo(m.message);

    if (ci?.participant) {
      list.push({ label: 'quoted_participant', jid: ci.participant, type: getJidTypeLocal(ci.participant) });
    }

    if (Array.isArray(ci?.mentionedJid)) {
      for (const j of ci.mentionedJid) {
        list.push({ label: 'mention', jid: j, type: getJidTypeLocal(j) });
      }
    }

    if (ci?.forwardedNewsletterMessageInfo?.newsletterJid) {
      const nj = ci.forwardedNewsletterMessageInfo.newsletterJid;
      list.push({ label: 'forwarded_channel', jid: nj, type: getJidTypeLocal(nj) });
    }

    const seen = new Set();
    const uniq = [];
    for (const it of list) {
      const key = `${it.label}:${it.jid}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(it);
      }
    }

    if (uniq.length === 0) {
      await sendWithChannel(sock, fromJid, { text: '✅ No JIDs found in this message.' }, { quoted: m });
      return;
    }

    const lines = [];
    lines.push(`🧭 Extracted JIDs (${uniq.length})`);
    for (const it of uniq) {
      const line = `• ${it.label}: ${it.jid} [${it.type}]`;
      lines.push(line);
      if (it.type === 'user') {
        const phone = phoneFromUserJid(it.jid);
        if (phone) lines.push(`  phone: ${phone}`);
      }
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to extract JIDs.' }, { quoted: m });
  }
}

// Export both ways to avoid module system mismatches
exports.handleJidInfo = handleJidInfo;
exports.handleExtractJid = handleExtractJid;
module.exports = { handleJidInfo, handleExtractJid };