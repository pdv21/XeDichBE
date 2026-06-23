const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authRepository = require('./auth.repository.js');
const { sendOTP } = require('../../shared/utils/mailer');
const { generateOTP, saveOTP, verifyOTP } = require('../../shared/utils/otp');

const register = async ({name, email, password, confirmPassword}) => {
    const existingUser = await authRepository.findUserByEmail(email);
    if(existingUser) {
        throw new Error('Email already exists');
    }

    if(password !== confirmPassword) {
        throw new Error('Passwords do not match');
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP and save to Redis
    const otp = generateOTP();
    saveOTP(email, { otp, name, hashedPassword });
    await sendOTP(email, otp);

    return {email}; // trả về email để client biết gửi OTP đến đâu, không trả về userId ngay
};

const verifyOtp = async ({email, otp}) => {
    const record = verifyOTP(email, otp);
    if(!record) {
        throw new Error('Invalid or expired OTP');
    }

    // Create user after OTP is verified
    const newUser = await authRepository.createUser({name: record.name, email, password: record.hashedPassword}); 
    return newUser;
};

const login = async ({email, password}) => {
    const user = await authRepository.findUserByEmail(email);
    if(!user) {
        throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if(!isMatch) {
        throw new Error('Invalid email or password');
    }

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: '1h'});
    return {token, user: { id: user.id, name: user.name, email: user.email }};
}

const resetPassword = async ({email}) => {
    const existingUser = await authRepository.findUserByEmail(email);
    if(!existingUser) {
        throw new Error('Email does not exist');
    }

    // Generate OTP and save to Redis
    const otp = generateOTP();
    saveOTP(email, {otp});
    await sendOTP(email, otp);

    return {email}; // trả về email để client biết gửi OTP đến đâu, không trả về userId ngay
};

const verifyResetOtp = async ({email, otp, password, confirmPassword}) => {
    const record = verifyOTP(email, otp);
    if(!record) {
        throw new Error('Invalid or expired OTP');
    }

    if(password !== confirmPassword) {
        throw new Error('Passwords do not match');
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password after OTP is verified
    const updatedUser = await authRepository.updateUserPassword(email, hashedPassword); 
    return updatedUser;
}

module.exports = { register, login, verifyOtp, resetPassword, verifyResetOtp };