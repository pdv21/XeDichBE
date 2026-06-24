const db = require('../../shared/config/database');

const findUserByEmail = async (email) => {
    const [rows] = await db.execute(
        'SELECT * FROM users WHERE email = ?',
        [email]
    );
    return rows[0];
}

const createUser = async ({name, email, password}) => {
    const [result] = await db.execute(
        'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
        [name, email, password]
    );
    return result.insertId;
}

const updateUserPassword = async (email, newPassword) => {
    const [result] = await db.execute(
        'UPDATE users SET password = ? WHERE email = ?',
        [newPassword, email]
    );
    return result.affectedRows > 0;
};

module.exports = { findUserByEmail, createUser, updateUserPassword };