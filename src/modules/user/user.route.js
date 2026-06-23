const express = require('express');
const router = express.Router();
const userController = require('./user.controller');

// Lấy danh sách user
router.get('/', userController.getAllUsers);

// Tìm kiếm user theo tên
router.get('/search', userController.searchUsers);

// Lấy thông tin 1 user theo id
router.get('/:id', userController.getUserById);

// Cập nhật thông tin user
router.put('/:id', userController.updateUser);

module.exports = router;
