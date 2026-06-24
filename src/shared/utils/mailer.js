const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTP = async (email, otp) => {
    const result = await resend.emails.send({
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