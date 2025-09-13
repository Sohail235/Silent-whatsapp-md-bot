const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

async function stealCommand(sock, chatId, message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedVideo = quoted?.videoMessage;
    const quotedImage = quoted?.imageMessage;

    if (quotedVideo) {
        const stream = await downloadContentFromMessage(quotedVideo, 'video');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // Save locally (optional)
        const filepath = path.join(__dirname, 'steal.mp4');
        fs.writeFileSync(filepath, buffer);

        // Send back to WhatsApp
        await sock.sendMessage(chatId, {
            video: buffer,
            fileName: 'steal.mp4',
            caption: 'GOTCHA💧'
        }, { quoted: message });

    } else if (quotedImage) {
        const stream = await downloadContentFromMessage(quotedImage, 'image');
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

        // Save locally (optional)
        const filepath = path.join(__dirname, 'steal.jpg');
        fs.writeFileSync(filepath, buffer);

        // Send back to WhatsApp
        await sock.sendMessage(chatId, {
            image: buffer,
            fileName: 'steal.jpg',
            caption: '✅ Stolen image'
        }, { quoted: message });

    } else {
        await sock.sendMessage(chatId, {
            text: '❌ Please reply to an image or video.'
        }, { quoted: message });
    }
}

module.exports = stealCommand;
