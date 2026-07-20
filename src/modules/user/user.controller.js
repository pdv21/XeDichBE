const userService = require('./user.service');
const { ok, error: errorResponse } = require('../../shared/utils/response');

const getAllUsers = async (req, res) => {
    try {
        const users = await userService.getAllUsers();
        return ok(res, users, 'Lấy danh sách người dùng thành công');
    } catch (error) {
        console.error('Error in getAllUsers:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi lấy danh sách', 500);
    }
};

const searchUsers = async (req, res) => {
    try {
        const { name } = req.query;
        const users = await userService.searchUsers(name);
        return ok(res, users, 'Tìm kiếm người dùng thành công');
    } catch (error) {
        if (error.statusCode) {
            return errorResponse(res, error.message, error.statusCode);
        }
        console.error('Error in searchUsers:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi tìm kiếm', 500);
    }
};

const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await userService.getUserById(id);
        return ok(res, user, 'Lấy thông tin người dùng thành công');
    } catch (error) {
        if (error.statusCode) {
            return errorResponse(res, error.message, error.statusCode);
        }
        console.error('Error in getUserById:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi lấy thông tin', 500);
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (String(req.user.id) !== String(id)) {
            return errorResponse(res, 'Bạn không có quyền cập nhật người dùng này', 403);
        }

        const { name, email } = req.body;

        // Only allow updating name and email
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;

        const updatedUser = await userService.updateUser(id, updateData);
        return ok(res, updatedUser, 'Cập nhật thông tin người dùng thành công');
    } catch (error) {
        if (error.statusCode) {
            return errorResponse(res, error.message, error.statusCode);
        }
        console.error('Error in updateUser:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi cập nhật thông tin', 500);
    }
};

const getMyPreferences = async (req, res) => {
    try {
        const prefs = await userService.getPreferences(req.user.id);
        return ok(res, prefs, 'Lấy sở thích du lịch thành công');
    } catch (error) {
        if (error.statusCode) {
            return errorResponse(res, error.message, error.statusCode);
        }
        console.error('Error in getMyPreferences:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi lấy sở thích', 500);
    }
};

const updateMyPreferences = async (req, res) => {
    try {
        const { interests, pace, w_price, w_rating, w_distance, w_preference } = req.body;
        const prefs = await userService.updatePreferences(req.user.id, {
            interests, pace, w_price, w_rating, w_distance, w_preference
        });
        return ok(res, prefs, 'Cập nhật sở thích du lịch thành công');
    } catch (error) {
        if (error.statusCode) {
            return errorResponse(res, error.message, error.statusCode);
        }
        console.error('Error in updateMyPreferences:', error);
        return errorResponse(res, 'Đã có lỗi xảy ra khi cập nhật sở thích', 500);
    }
};

module.exports = {
    getAllUsers,
    searchUsers,
    getUserById,
    updateUser,
    getMyPreferences,
    updateMyPreferences
};
