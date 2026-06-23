const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.post('/verify-register-otp', authController.verifyOtp);
router.post('/reset-password', authController.resetPassword);
router.post('/verify-reset-otp', authController.verifyResetOtp);

module.exports = router;