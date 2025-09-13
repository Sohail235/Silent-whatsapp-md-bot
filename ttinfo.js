// ttinfo.js
// Extract TikTok profile info from a local data source.
// Clean, modular, and production-ready.

'use strict';

/**
 * Structure for TikTok Profile Data
 * @typedef {Object} TikTokProfile
 * @property {string} pfp - Profile picture URL
 * @property {string} username - TikTok handle
 * @property {string} name - Display name
 * @property {string} bio - User bio/description
 * @property {number} followingCount - Number following
 * @property {number} followersCount - Number of followers
 * @property {boolean} verified - Verified status
 * @property {number} posts - Number of posts/videos
 * @property {number} likesCount - Total likes received
 */

/**
 * Example local database. Replace/add real users or load from file/db as needed.
 */
const TIKTOK_DB = {
    tiktok: {
        pfp: 'https://p16-sign-va.tiktokcdn.com/tiktok-avatar.jpg',
        username: 'tiktok',
        name: 'TikTok Official',
        bio: 'The official TikTok account.',
        followingCount: 100,
        followersCount: 100000000,
        verified: true,
        posts: 120,
        likesCount: 500000000
    },
    venom22: {
        pfp: 'https://p16-sign-va.tiktokcdn.com/venom22-avatar.jpg',
        username: 'venom22',
        name: 'Venom',
        bio: 'Stay toxic 😈',
        followingCount: 200,
        followersCount: 25000,
        verified: false,
        posts: 76,
        likesCount: 87000
    }
    // Add more users here
};

/**
 * Extract TikTok profile info for a given username.
 * @param {string} username - TikTok username/handle
 * @returns {TikTokProfile|null} Profile data or null if not found
 */
function getTikTokProfile(username) {
    if (!username) return null;
    const key = username.trim().toLowerCase();
    return TIKTOK_DB[key] || null;
}

/**
 * Extracts TikTok profile info from a raw data object.
 * Used internally; exported for modularity.
 * @param {Object} rawData - Raw TikTok profile data
 * @returns {TikTokProfile} Normalized profile info
 */
function extractTikTokProfile(rawData) {
    if (!rawData || typeof rawData !== 'object') {
        throw new Error('Invalid TikTok profile data provided.');
    }
    return {
        pfp: rawData.pfp || '',
        username: rawData.username || '',
        name: rawData.name || '',
        bio: rawData.bio || '',
        followingCount: typeof rawData.followingCount === 'number' ? rawData.followingCount : 0,
        followersCount: typeof rawData.followersCount === 'number' ? rawData.followersCount : 0,
        verified: !!rawData.verified,
        posts: typeof rawData.posts === 'number' ? rawData.posts : 0,
        likesCount: typeof rawData.likesCount === 'number' ? rawData.likesCount : 0
    };
}

module.exports = {
    getTikTokProfile,
    extractTikTokProfile
};