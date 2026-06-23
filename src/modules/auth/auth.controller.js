const response = require('../../shared/utils/response');
const authService = require('./auth.service');

const register = async (req, res) => {
    try {
        const {name, email, password, confirmPassword} = req.body;
        const newUser = await authService.register({name, email, password, confirmPassword});
        return response.ok(res, {userId: newUser}, 'User registered successfully', 201);
    } catch (error) {
        return response.error(res, error.message, 400);
    }
}

const verifyOtp = async (req, res) => {
    try {
        const {email, otp} = req.body;
        const newUser = await authService.verifyOtp({email, otp});
        return response.ok(res, {userId: newUser}, 'User registered successfully', 201);
    } catch (error) {
        return response.error(res, error.message, 400);
    }
}

const login = async (req, res) => {
    try {
        const {email, password} = req.body;
        const result = await authService.login({email, password});
        res.cookie('token', result.token, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production' ,
            maxAge: 7*24*60*60*1000, // 7 days,
            sameSite: 'Strict'
        });
        return response.ok(res, result, 'Login successful', 200);
    } catch (error) {
        return response.error(res, error.message, 400);
    }
}

const logout = async (req, res) => {
    res.clearCookie('token');
    return response.ok(res, null, 'Logout successful', 200);
}

const resetPassword = async (req, res) => {
    try {
        const {email} = req.body;
        const result = await authService.resetPassword({email});
        return response.ok(res, result, 'OTP sent successfully', 200);
    } catch (error) {
        return response.error(res, error.message, 400);
    }   
}

const verifyResetOtp = async (req, res) => {
    try {
        const {email, otp, password, confirmPassword} = req.body;
        const result = await authService.verifyResetOtp({email, otp, password, confirmPassword});
        return response.ok(res, result, 'Password reset successful', 200);
    } catch (error) {
        return response.error(res, error.message, 400);
    }
}

module.exports = { register, login, logout, verifyOtp, resetPassword, verifyResetOtp };