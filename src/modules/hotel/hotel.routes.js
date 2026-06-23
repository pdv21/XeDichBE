const express = require('express');
const router = express.Router();
const hotelController = require('./hotel.controller');

router.get('/search', hotelController.search);
router.get('/:hotelKey/rates', hotelController.detail);

module.exports = router;