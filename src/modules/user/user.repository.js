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

// ─── Preferences (sở thích du lịch — bảng user_preferences, 1 dòng/user) ─────
const findPreferences = async (userId) => {
    const [rows] = await db.execute(
        'SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1',
        [userId]
    );
    return rows[0] ?? null;
};

const createDefaultPreferences = async (userId) => {
    await db.execute(
        'INSERT INTO user_preferences (user_id, interests) VALUES (?, JSON_ARRAY())',
        [userId]
    );
    return findPreferences(userId);
};

const updatePreferences = async (userId, data) => {
    const fields = [];
    const values = [];

    if (data.interests !== undefined) {
        fields.push('interests = ?');
        values.push(JSON.stringify(data.interests));
    }
    if (data.pace !== undefined) {
        fields.push('pace = ?');
        values.push(data.pace);
    }
    for (const w of ['w_price', 'w_rating', 'w_distance', 'w_preference']) {
        if (data[w] !== undefined) {
            fields.push(`${w} = ?`);
            values.push(data[w]);
        }
    }

    if (fields.length === 0) return false;

    values.push(userId);
    const [result] = await db.execute(
        `UPDATE user_preferences SET ${fields.join(', ')} WHERE user_id = ?`,
        values
    );
    return result.affectedRows > 0;
};

module.exports = {
    findAllUsers,
    findUserById,
    searchUsersByName,
    updateUser,
    findPreferences,
    createDefaultPreferences,
    updatePreferences
};
