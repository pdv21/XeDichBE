const express = require('express');
const router = express.Router();
const userController = require('./user.controller');
const { authenticate } = require('../../shared/middlewares/auth.middleware');

router.use(authenticate);

// Khai báo route tĩnh (me/...) TRƯỚC '/:id' để không bị nuốt bởi param route
router.get('/me/preferences', userController.getMyPreferences);
router.put('/me/preferences', userController.updateMyPreferences);

router.get('/', userController.getAllUsers);
router.get('/search', userController.searchUsers);
router.get('/:id', userController.getUserById);
router.put('/:id', userController.updateUser);

module.exports = router;
