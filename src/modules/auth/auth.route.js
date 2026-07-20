const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('./auth.controller');

// Chống brute-force: giới hạn 10 request/15 phút cho mỗi IP trên các endpoint nhạy cảm
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau', data: null },
});

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.post('/verify-register-otp', authLimiter, authController.verifyOtp);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/verify-reset-otp', authLimiter, authController.verifyResetOtp);

module.exports = router;