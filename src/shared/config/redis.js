const { Redis } = require('ioredis');

// REDIS_URL (vd Upstash: rediss://default:xxx@host:port — rediss:// tự bật TLS qua
// ioredis) ưu tiên hơn khi có; local dev vẫn dùng REDIS_HOST/REDIS_PORT rời như cũ.
const redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
    : new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        maxRetriesPerRequest: null, // bắt buộc cho BullMQ
    });

redis.on('connect', () => console.log('[Redis] Kết nối thành công'));
redis.on('error', (err) => console.error('[Redis] Lỗi:', err.message));

module.exports = redis;