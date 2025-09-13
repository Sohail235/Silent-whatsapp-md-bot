/**
 * Link → JID extractor for WhatsApp links
 *
 * Command:
 *  - .linkjid [link]  — Extracts JIDs from WhatsApp links in the message, arguments, or quoted text.
 *                       Supports:
 *                       • Group invite: https://chat.whatsapp.com/<inviteCode>
 *                       • Click-to-chat: https://wa.me/<number>, https://api.whatsapp.com/send?phone=<number>
 *                       • Channel link: https://whatsapp.com/channel/<token> (best-effort, see notes)
 *
 * Notes:
 *  - Group: we resolve invite codes via Baileys groupGetInviteInfo and return the real group JID.
 *  - User: we derive the JID of the number (no registration verification is performed).
 *  - Channel: WhatsApp channel links use a token that cannot be directly translated to a @newsletter JID
 *             via public Baileys methods. We show the token and, if possible, try optional sock.newsletterGetInfo.
 */

const MAX_LINKS = 10;

const RE_GROUP_INVITE = /https?:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9-_]{10,})/ig;
const RE_WA_ME_NUMBER = /https?:\/\/wa\.me\/(\d{6,20})(?:[/?#]|$)/ig;
const RE_API_SEND_PHONE = /https?:\/\/api\.whatsapp\.com\/send\?[^#\s]*\bphone=(\d{6,20})/ig;
const RE_CHANNEL_LINK = /https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9_-]{6,128})/ig;

function getAllMatches(regex, text) {
  const out = [];
  if (!text) return out;
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(text)) && out.length < MAX_LINKS) {
    out.push(m[1]);
  }
  return out;
}

function getQuotedText(m) {
  const q = m?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return '';
  return (q.conversation || q.extendedTextMessage?.text || '').trim();
}

function asUserJidFromDigits(digits) {
  return `${digits}@s.whatsapp.net`;
}

async function resolveGroupInvite(sock, code) {
  try {
    const info = await sock.groupGetInviteInfo(code);
    // info: { id: 'xxx-xxx@g.us', subject, subjectOwner, size, creation, ... }
    return {
      ok: true,
      jid: info?.id || '',
      subject: info?.subject || '',
      size: info?.size || undefined
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to resolve invite' };
  }
}

async function maybeResolveChannel(sock, token) {
  // Baileys does not expose a stable public method to map the channel link token -> @newsletter JID yet.
  // We return the token and try optional method if present.
  const result = { token, resolved: false, jid: '', meta: null, note: 'Direct JID resolution from link token is not available.' };
  try {
    if (typeof sock.newsletterGetInfo === 'function') {
      const meta = await sock.newsletterGetInfo(token);
      if (meta?.jid) {
        result.resolved = true;
        result.jid = meta.jid;
        result.meta = meta;
        result.note = '';
      }
    }
  } catch {
    // ignore; keep best-effort info
  }
  return result;
}

async function handleLinkJid(sock, fromJid, m, rawArgText, sendWithChannel) {
  try {
    const argText = (rawArgText || '').trim();
    const bodyText =
      m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      '';

    const quotedText = getQuotedText(m);

    // Scan inputs in priority: args > body > quoted
    const scanBuckets = [argText, bodyText, quotedText].filter(Boolean);
    if (scanBuckets.length === 0) {
      await sendWithChannel(sock, fromJid, { text: '⚠️ Send a WhatsApp link or reply to a message containing one.\nExamples:\n• .linkjid https://chat.whatsapp.com/ABCDEFG1234\n• .linkjid https://wa.me/15551234567\n• Reply to a link with .linkjid' }, { quoted: m });
      return;
    }

    const found = {
      groupInvites: [],
      numbers: [],
      apiPhones: [],
      channels: []
    };

    for (const text of scanBuckets) {
      found.groupInvites.push(...getAllMatches(RE_GROUP_INVITE, text));
      found.numbers.push(...getAllMatches(RE_WA_ME_NUMBER, text));
      found.apiPhones.push(...getAllMatches(RE_API_SEND_PHONE, text));
      found.channels.push(...getAllMatches(RE_CHANNEL_LINK, text));
    }

    const lines = [];
    lines.push('🧭 Link → JID Extraction');

    // Resolve group invites
    if (found.groupInvites.length) {
      lines.push('');
      lines.push(`• Groups (${found.groupInvites.length})`);
      for (const code of found.groupInvites.slice(0, MAX_LINKS)) {
        const r = await resolveGroupInvite(sock, code);
        if (r.ok) {
          lines.push(`  - invite: ${code}`);
          lines.push(`    jid: ${r.jid}`);
          if (r.subject) lines.push(`    subject: ${r.subject}`);
          if (typeof r.size === 'number') lines.push(`    size: ${r.size}`);
        } else {
          lines.push(`  - invite: ${code}`);
          lines.push(`    error: ${r.error}`);
        }
      }
    }

    // Click-to-chat numbers (wa.me/<digits>)
    const allNumbers = [...found.numbers, ...found.apiPhones];
    if (allNumbers.length) {
      lines.push('');
      lines.push(`• Users (${allNumbers.length})`);
      for (const num of allNumbers.slice(0, MAX_LINKS)) {
        const jid = asUserJidFromDigits(num);
        lines.push(`  - number: ${num}`);
        lines.push(`    jid: ${jid}`);
      }
    }

    // Channel links
    if (found.channels.length) {
      lines.push('');
      lines.push(`• Channels (${found.channels.length})`);
      for (const token of found.channels.slice(0, MAX_LINKS)) {
        const ch = await maybeResolveChannel(sock, token);
        lines.push(`  - link_token: ${token}`);
        if (ch.resolved && ch.jid) {
          lines.push(`    jid: ${ch.jid}`);
        } else {
          lines.push(`    note: ${ch.note}`);
        }
      }
      lines.push('  Tip: To get a channel JID from a message, use .jidinfo or .extractjid on a forwarded post.');
    }

    if (
      !found.groupInvites.length &&
      !allNumbers.length &&
      !found.channels.length
    ) {
      await sendWithChannel(sock, fromJid, { text: '✅ No supported WhatsApp links found.\nSupported:\n• chat.whatsapp.com/<invite>\n• wa.me/<number>\n• api.whatsapp.com/send?phone=<number>\n• whatsapp.com/channel/<token>' }, { quoted: m });
      return;
    }

    await sendWithChannel(sock, fromJid, { text: lines.join('\n') }, { quoted: m });
  } catch (err) {
    await sendWithChannel(sock, fromJid, { text: '❌ Failed to extract JIDs from link(s).' }, { quoted: m });
  }
}

module.exports = {
  handleLinkJid
};