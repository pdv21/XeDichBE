const db = require('../../shared/config/database');

const findAllUsers = async () => {
    const [rows] = await db.execute(
        'SELECT id, name, email, created_at, updated_at FROM users'
    );
    return rows;
};

const findUserById = async (id) => {
    const [rows] = await db.execute(
        'SELECT id, name, email, created_at, updated_at FROM users WHERE id = ?',
        [id]
    );
    return rows[0];
};

const searchUsersByName = async (name) => {
    const [rows] = await db.execute(
        'SELECT id, name, email, created_at, updated_at FROM users WHERE name LIKE ?',
        [`%${name}%`]
    );
    return rows;
};

const updateUser = async (id, data) => {
    const fields = [];
    const values = [];

    if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
    }
    if (data.email !== undefined) {
        fields.push('email = ?');
        values.push(data.email);
    }

    if (fields.length === 0) return false;

    values.push(id);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;

    const [result] = await db.execute(query, values);
    return result.affectedRows > 0;
};

module.exports = {
    findAllUsers,
    findUserById,
    searchUsersByName,
    updateUser
};
