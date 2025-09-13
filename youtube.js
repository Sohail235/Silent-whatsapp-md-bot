/**
 * Youtube Downloader Module
 * Features:
 * - .ytv <query>: Download MP4 video (default ~360p) by search query (returns direct video link or file)
 * - .yta <query>: Download MP3 audio by search query (returns direct audio link or file)
 *
 * Dependencies: axios (npm i axios)
 * Uses public API endpoints for search and download (no API key required).
 * For best reliability, you can swap endpoints if blocked.
 */

const axios = require('axios');

// Helper: Search YouTube and get videoId (uses public API)
async function searchYouTube(query) {
  try {
    // Using ytsearch.minitools.me (no API key, returns JSON)
    const { data } = await axios.get(`https://ytsearch.minitools.me/api/search?query=${encodeURIComponent(query)}&limit=1&type=video`);
    if (!data || !data.results || !data.results.length) return null;
    return data.results[0]; // {videoId, title, description, thumbnails, etc.}
  } catch (e) {
    return null;
  }
}

// Helper: Get MP4 download link for a YouTube video (uses ytmp3.plus API)
async function getYTV(videoId) {
  try {
    // ytmp3.plus API returns downloadable URLs (no API key)
    const { data } = await axios.get(`https://ytmp3.plus/api/download/${videoId}/mp4`);
    if (!data || !data.url) return null;
    return data; // {url, title, thumbnail, etc.}
  } catch (e) {
    return null;
  }
}

// Helper: Get MP3 download link for a YouTube video (uses ytmp3.plus API)
async function getYTA(videoId) {
  try {
    const { data } = await axios.get(`https://ytmp3.plus/api/download/${videoId}/mp3`);
    if (!data || !data.url) return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Handler for .ytv <query>
async function handleYTV(sock, chatId, message, query, sendWithChannel) {
  query = String(query || '').trim();
  if (!query) {
    await sendWithChannel(sock, chatId, { text: 'Usage:\n.ytv <search terms>\nExample: .ytv Alan Walker Faded' }, { quoted: message });
    return;
  }
  // Search YouTube
  const video = await searchYouTube(query);
  if (!video) {
    await sendWithChannel(sock, chatId, { text: `❌ No video found for: ${query}` }, { quoted: message });
    return;
  }
  // Get MP4 download link
  const dl = await getYTV(video.videoId);
  if (!dl || !dl.url) {
    await sendWithChannel(sock, chatId, { text: `❌ Could not get MP4 download link for "${video.title}".` }, { quoted: message });
    return;
  }
  // Send video link with info
  await sendWithChannel(sock, chatId, {
    video: { url: dl.url },
    caption: `🎬 [YTV]\nTitle: ${video.title}\n\nDownload: ${dl.url}\n\nSource: YouTube`
  }, { quoted: message });
}

// Handler for .yta <query>
async function handleYTA(sock, chatId, message, query, sendWithChannel) {
  query = String(query || '').trim();
  if (!query) {
    await sendWithChannel(sock, chatId, { text: 'Usage:\n.yta <search terms>\nExample: .yta Alan Walker Faded' }, { quoted: message });
    return;
  }
  // Search YouTube
  const video = await searchYouTube(query);
  if (!video) {
    await sendWithChannel(sock, chatId, { text: `❌ No video found for: ${query}` }, { quoted: message });
    return;
  }
  // Get MP3 download link
  const dl = await getYTA(video.videoId);
  if (!dl || !dl.url) {
    await sendWithChannel(sock, chatId, { text: `❌ Could not get MP3 download link for "${video.title}".` }, { quoted: message });
    return;
  }
  // Send audio link with info
  await sendWithChannel(sock, chatId, {
    audio: { url: dl.url },
    mimetype: 'audio/mp3',
    caption: `🎵 [YTA]\nTitle: ${video.title}\n\nDownload: ${dl.url}\n\nSource: YouTube`
  }, { quoted: message });
}

module.exports = {
  handleYTV,
  handleYTA
};