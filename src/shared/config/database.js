const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // mysql2 mặc định negotiate charset utf8 (3-byte, utf8_general_ci) nếu không
    // khai báo — lệch với bảng tạo utf8mb4_unicode_ci (init.sql), gây lỗi
    // "Conversion from collation ... impossible" khi param chứa ký tự 4-byte
    // (emoji...) thường gặp trong tên quán ăn/địa điểm crawl từ OpenTripMap.
    charset: 'utf8mb4'
});

module.exports = pool;