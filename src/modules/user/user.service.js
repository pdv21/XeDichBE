const userRepository = require('./user.repository');

const getAllUsers = async () => {
    return await userRepository.findAllUsers();
};

const getUserById = async (id) => {
    const user = await userRepository.findUserById(id);
    if (!user) {
        const error = new Error('Không tìm thấy người dùng');
        error.statusCode = 404;
        throw error;
    }
    return user;
};

const searchUsers = async (name) => {
    if (!name || name.trim() === '') {
        const error = new Error('Vui lòng cung cấp tên để tìm kiếm');
        error.statusCode = 400;
        throw error;
    }
    return await userRepository.searchUsersByName(name.trim());
};

const updateUser = async (id, data) => {
    const user = await userRepository.findUserById(id);
    if (!user) {
        const error = new Error('Không tìm thấy người dùng để cập nhật');
        error.statusCode = 404;
        throw error;
    }

    const isUpdated = await userRepository.updateUser(id, data);
    if (!isUpdated && Object.keys(data).length > 0) {
        const error = new Error('Cập nhật không thành công');
        error.statusCode = 500;
        throw error;
    }

    return await userRepository.findUserById(id);
};

// ─── Preferences ──────────────────────────────────────────────────────────────
const VALID_INTERESTS = ['food', 'beach', 'culture', 'nature', 'nightlife', 'shopping'];
const VALID_PACES = ['relaxed', 'moderate', 'packed'];

// Tự tạo bản ghi mặc định nếu user chưa có (lazy init) — client không cần
// gọi endpoint tạo riêng
const getPreferences = async (userId) => {
    const prefs = await userRepository.findPreferences(userId);
    if (prefs) return prefs;
    return userRepository.createDefaultPreferences(userId);
};

const updatePreferences = async (userId, { interests, pace, w_price, w_rating, w_distance, w_preference }) => {
    if (interests !== undefined) {
        if (!Array.isArray(interests) || interests.some(i => !VALID_INTERESTS.includes(i))) {
            const error = new Error(`interests phải là mảng con của: ${VALID_INTERESTS.join(', ')}`);
            error.statusCode = 400;
            throw error;
        }
    }
    if (pace !== undefined && !VALID_PACES.includes(pace)) {
        const error = new Error(`pace phải là: ${VALID_PACES.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }

    // 4 trọng số scoring phải gửi đủ cùng nhau và cộng lại = 1.0
    const weights = [w_price, w_rating, w_distance, w_preference];
    const sentWeights = weights.filter(w => w !== undefined);
    if (sentWeights.length > 0) {
        if (sentWeights.length !== 4) {
            const error = new Error('Phải gửi đủ 4 trọng số: w_price, w_rating, w_distance, w_preference');
            error.statusCode = 400;
            throw error;
        }
        const nums = weights.map(Number);
        if (nums.some(n => Number.isNaN(n) || n < 0 || n > 1)) {
            const error = new Error('Mỗi trọng số phải là số trong khoảng 0-1');
            error.statusCode = 400;
            throw error;
        }
        const sum = nums.reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1) > 0.001) {
            const error = new Error(`Tổng 4 trọng số phải bằng 1.0 (hiện tại: ${sum.toFixed(2)})`);
            error.statusCode = 400;
            throw error;
        }
    }

    await getPreferences(userId); // đảm bảo bản ghi tồn tại trước khi UPDATE
    await userRepository.updatePreferences(userId, { interests, pace, w_price, w_rating, w_distance, w_preference });
    return userRepository.findPreferences(userId);
};

module.exports = {
    getAllUsers,
    getUserById,
    searchUsers,
    updateUser,
    getPreferences,
    updatePreferences
};
