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

module.exports = {
    getAllUsers,
    getUserById,
    searchUsers,
    updateUser
};
