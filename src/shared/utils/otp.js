const crypto = require('crypto');
const redis = require('../config/redis');

const OTP_TTL_SECONDS = 5 * 60; // 5 phút
const otpKey = (email) => `otp:${email}`;

const generateOTP = () => {
    return crypto.randomInt(100000, 999999).toString(); // 6 số
};

const verifyOTP = async (email, otp) => {
    const key = otpKey(email);
    const raw = await redis.get(key);
    if (!raw) return null;

    const record = JSON.parse(raw);
    if (record.otp !== otp) return null;

    await redis.del(key);
    return record; // trả về data thay vì boolean
};

const saveOTP = async (email, data) => {
    await redis.set(otpKey(email), JSON.stringify(data), 'EX', OTP_TTL_SECONDS);
};

module.exports = { generateOTP, saveOTP, verifyOTP };
