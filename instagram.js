const { igdl } = require("ruhend-scraper");

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

// Channel Branding Info
const CHANNEL_INFO = {
    jid: '120363418092205499@newsletter', // your channel JID
    name: '🩸ᏕᎥᏝᏋᏁᏖ ᏦᎥᏝᏝᏕ🩸' // visible name in WhatsApp
};

async function instagramCommand(sock, chatId, message) {
    try {
        // Check if message has already been processed
        if (processedMessages.has(message.key.id)) return;

        // Add message ID to processed set
        processedMessages.add(message.key.id);

        // Clean up old message IDs after 5 minutes
        setTimeout(() => {
            processedMessages.delete(message.key.id);
        }, 5 * 60 * 1000);

        // Extract text
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
        if (!text) {
            return await sock.sendMessage(chatId, { 
                text: "⚠️ Please provide an Instagram link for the media." 
            }, { quoted: message });
        }

        // Validate Instagram URL
        const instagramPatterns = [
            /https?:\/\/(?:www\.)?instagram\.com\//,
            /https?:\/\/(?:www\.)?instagr\.am\//,
            /https?:\/\/(?:www\.)?instagram\.com\/p\//,
            /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
            /https?:\/\/(?:www\.)?instagram\.com\/tv\//
        ];

        const isValidUrl = instagramPatterns.some(pattern => pattern.test(text));
        if (!isValidUrl) {
            return await sock.sendMessage(chatId, { 
                text: "❌ That is not a valid Instagram link. Please provide a valid post, reel, or video link." 
            }, { quoted: message });
        }

        // React to show processing
        await sock.sendMessage(chatId, {
            react: { text: '⏳', key: message.key }
        });

        // Fetch media
        const downloadData = await igdl(text);
        if (!downloadData || !downloadData.data || downloadData.data.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: "❌ No media found at the provided link." 
            }, { quoted: message });
        }

        const mediaData = downloadData.data;

        for (let i = 0; i < Math.min(20, mediaData.length); i++) {
            const media = mediaData[i];
            const mediaUrl = media.url;

            // Skip if URL is invalid
            if (!mediaUrl) continue;

            // Determine if it’s video
            const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaUrl) || 
                            media.type === 'video' || 
                            text.includes('/reel/') || 
                            text.includes('/tv/');

            // Build message payload
            const messagePayload = {
                caption: isVideo ? "🎬 Here’s your video!" : "🖼️ Here’s your image!",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: CHANNEL_INFO.jid,
                        newsletterName: CHANNEL_INFO.name,
                        serverMessageId: -1
                    }
                }
            };

            if (isVideo) messagePayload.video = { url: mediaUrl, mimetype: "video/mp4" };
            else messagePayload.image = { url: mediaUrl };

            // Send media
            await sock.sendMessage(chatId, messagePayload, { quoted: message });
        }

    } catch (error) {
        console.error('Instagram command error:', error);
        await sock.sendMessage(chatId, { 
            text: "❌ An error occurred while processing the Instagram link." 
        }, { quoted: message });
    }
}

module.exports = instagramCommand;
