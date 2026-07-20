const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const hotelController = require("./hotel.controller");

// Route này forward sang LiteAPI (API trả phí theo lượt gọi) — giới hạn để
// tránh bị spam/tốn quota. /rates là lệnh gọi tốn kém nhất nên giới hạn chặt hơn.
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu, vui lòng thử lại sau" },
});

const ratesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Quá nhiều yêu cầu, vui lòng thử lại sau" },
});

router.get("/search-by-city", searchLimiter, hotelController.searchByCity);
router.get("/search-by-ids", searchLimiter, hotelController.searchByIds);
router.get("/:hotelId", searchLimiter, hotelController.getDetail);
router.post("/rates", ratesLimiter, hotelController.getRates);

module.exports = router;
