const { Resend } = require('resend');

// Khởi tạo lazy (không phải lúc require module) — thiếu RESEND_API_KEY chỉ nên
// làm hỏng luồng gửi mail (OTP), không được làm crash cả server lúc boot.
let resend = null;
const getClient = () => {
    if (!process.env.RESEND_API_KEY) {
        throw Object.assign(new Error('Chưa cấu hình RESEND_API_KEY — không gửi được email'), { statusCode: 500 });
    }
    if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
    return resend;
};

const sendOTP = async (email, otp) => {
    const result = await getClient().emails.send({
        from: process.env.MAIL_FROM,
        to: email,
        subject: 'Mã OTP xác thực tài khoản',
        html: `
            <h2>Xác thực tài khoản XeDich</h2>
            <p>Mã OTP của bạn là:</p>
            <h1 style="color: #4F46E5; letter-spacing: 8px;">${otp}</h1>
            <p>Mã có hiệu lực trong <strong>5 phút</strong></p>
            <p>Nếu bạn không yêu cầu mã này, hãy bỏ qua email này.</p>
        `
    });
    console.log('Resend result:', JSON.stringify(result));
};

module.exports = { sendOTP };