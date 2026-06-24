const { Redis } = require('ioredis');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null, // bắt buộc cho BullMQ
});

redis.on('connect', () => console.log('[Redis] Kết nối thành công'));
redis.on('error', (err) => console.error('[Redis] Lỗi:', err.message));

module.exports = redis;