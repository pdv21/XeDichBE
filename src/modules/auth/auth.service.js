const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authRepository = require('./auth.repository.js');
const { sendOTP } = require('../../shared/utils/mailer');
const { generateOTP, saveOTP, verifyOTP } = require('../../shared/utils/otp');

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const register = async ({name, email, password, confirmPassword}) => {
    const existingUser = await authRepository.findUserByEmail(email);
    if(existingUser) {
        throw validationError('Email already exists', 409);
    }

    if(password !== confirmPassword) {
        throw validationError('Passwords do not match', 400);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate OTP and save to Redis
    const otp = generateOTP();
    await saveOTP(email, { otp, name, hashedPassword });
    await sendOTP(email, otp);

    return {email}; // trả về email để client biết gửi OTP đến đâu, không trả về userId ngay
};

const verifyOtp = async ({email, otp}) => {
    const record = await verifyOTP(email, otp);
    if(!record) {
        throw validationError('Invalid or expired OTP', 400);
    }

    // Create user after OTP is verified
    const newUser = await authRepository.createUser({name: record.name, email, password: record.hashedPassword}); 
    return newUser;
};

// Hash "vô chủ" dùng để compare khi user không tồn tại — tránh lộ thông tin qua timing attack
const DUMMY_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8gwm7CSKn.FIN4V7Uau0nqcSF6mQMe';

const login = async ({email, password}) => {
    const user = await authRepository.findUserByEmail(email);
    const isMatch = await bcrypt.compare(password, user?.password || DUMMY_HASH);
    if(!user || !isMatch) {
        throw validationError('Invalid email or password', 401);
    }

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: '1h'});
    return {token, user: { id: user.id, name: user.name, email: user.email }};
}

const resetPassword = async ({email}) => {
    const existingUser = await authRepository.findUserByEmail(email);
    if(!existingUser) {
        throw validationError('Email does not exist', 404);
    }

    // Generate OTP and save to Redis
    const otp = generateOTP();
    await saveOTP(email, {otp});
    await sendOTP(email, otp);

    return {email}; // trả về email để client biết gửi OTP đến đâu, không trả về userId ngay
};

const verifyResetOtp = async ({email, otp, password, confirmPassword}) => {
    const record = await verifyOTP(email, otp);
    if(!record) {
        throw validationError('Invalid or expired OTP', 400);
    }

    if(password !== confirmPassword) {
        throw validationError('Passwords do not match', 400);
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password after OTP is verified
    const updated = await authRepository.updateUserPassword(email, hashedPassword);
    if(!updated) {
        throw validationError('Failed to reset password', 500);
    }
    return {email};
}

module.exports = { register, login, verifyOtp, resetPassword, verifyResetOtp };