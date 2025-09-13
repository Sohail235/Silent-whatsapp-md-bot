const fetch = require('node-fetch');

/**
 * Downloads TikTok video info from the API.
 * @param {string} url - The TikTok video URL.
 * @returns {Promise<Object>} - Returns JSON with video info or throws an error.
 */
async function downloadTikTok(url) {
    if (!url) throw new Error('No TikTok URL provided');

    try {
        const apiUrl = `https://batgpt.vercel.app/api/tik?url=${encodeURIComponent(url)}`;
        const res = await fetch(apiUrl);
        const data = await res.json();

        if (!data || !data.videoUrl) {
            throw new Error('Failed to fetch TikTok video');
        }

        return {
            videoUrl: data.videoUrl, // Direct video URL
            author: data.author || null,
            title: data.title || null
        };
    } catch (err) {
        throw new Error(`Error fetching TikTok video: ${err.message}`);
    }
}

module.exports = { downloadTikTok };