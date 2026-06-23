const crypto = require('crypto');

const generateOTP = () => {
    return crypto.randomInt(100000, 999999).toString(); // 6 số
};

const otpStore = new Map(); // tạm thời lưu trong memory, sau dùng Redis

const verifyOTP = (email, otp) => {
    const record = otpStore.get(email);
    if (!record) return null;
    if (Date.now() > record.expiresAt) {
        otpStore.delete(email);
        return null;
    }
    if (record.otp !== otp) return null;
    otpStore.delete(email);
    return record; // trả về data thay vì boolean
};

const saveOTP = (email, data) => {
    otpStore.set(email, {
        ...data,
        expiresAt: Date.now() + 5 * 60 * 1000
    });
};

module.exports = { generateOTP, saveOTP, verifyOTP };