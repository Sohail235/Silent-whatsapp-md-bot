/**
 * Sticker Maker (.sm) module for Silent Bot
 * Usage: .sm (reply to an image or video ≤ 10s)
 * Converts replied image/video to webp sticker using ffmpeg.
 * Requires ffmpeg installed on host.
 *
 * Compatible with Baileys v4+ and your present bot.js routing.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const { execFile } = require('child_process');
const sharp = require('sharp');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Sticker metadata
const STICKER_AUTHOR = "Silent Bot";
const STICKER_PACK = "Silent Pack";

// Helper: Convert image/video buffer to webp sticker using ffmpeg
async function toWebpSticker(inputBuffer, kind) {
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

/**
 * Main handler for .sm command
 * @param {object} sock - Baileys socket instance
 * @param {string} chatId - WhatsApp chat JID
 * @param {object} message - Baileys message object
 * @param {function} sendWithChannel - Function to send message, with channel context
 */
async function handleSM(sock, chatId, message, sendWithChannel) {
  // Try quoted message first
  let quoted = message?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  let img = quoted?.imageMessage || message?.message?.imageMessage;
  let vid = quoted?.videoMessage || message?.message?.videoMessage;

  // If not found, fallback to direct message image/video
  if (!img && !vid) {
    quoted = message?.message?.imageMessage || message?.message?.videoMessage;
    if (quoted?.mimetype?.startsWith('image')) img = quoted;
    if (quoted?.mimetype?.startsWith('video')) vid = quoted;
  }

  if (!img && !vid) {
    await sendWithChannel(sock, chatId, { text: '🖼️ Reply to an image/video with .sm to create a sticker.\n• Video must be ≤ 10s.' }, { quoted: message });
    return;
  }

  if (vid && Number(vid.seconds || 0) > 10) {
    await sendWithChannel(sock, chatId, { text: '⏱️ Video too long. Please use a clip of 10 seconds or less.' }, { quoted: message });
    return;
  }

  const kind = img ? 'image' : 'video';
  const mediaMsg = img || vid;
  const typeForDl = kind === 'video' ? 'video' : 'image';

  try {
    // Use Baileys universal API to download media
    const stream = await downloadContentFromMessage(mediaMsg, typeForDl);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const mediaBuf = Buffer.concat(chunks);

    // Validate image buffer (for image input)
    if (kind === 'image') {
      try {
        await sharp(mediaBuf).metadata();
      } catch (e) {
        throw new Error('Invalid image buffer, not a valid image');
      }
    }

    const webp = await toWebpSticker(mediaBuf, kind);

    await sendWithChannel(
      sock,
      chatId,
      {
        sticker: webp,
        packname: STICKER_PACK,
        author: STICKER_AUTHOR
      },
      { quoted: message }
    );
  } catch (err) {
    console.error('sm error:', err?.stack || err?.message || err);
    await sendWithChannel(sock, chatId, {
      text: `❌ Failed to make sticker. Debug: ${err?.message || err}`
    }, { quoted: message });
  }
}

module.exports = { handleSM };