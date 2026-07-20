const express = require("express");
const router = express.Router();
const locationRepository = require("./location.repository");
const response = require("../../shared/utils/response");

// Danh sách thành phố hỗ trợ — public, frontend dùng cho dropdown chọn thành phố
router.get("/", async (req, res) => {
  try {
    const locations = await locationRepository.getAllLocations();
    const data = locations.map((l) => ({
      city_code: l.city_code,
      city_name: l.city_name,
      country_code: l.country_code,
    }));
    return response.ok(res, data, "Lấy danh sách thành phố thành công");
  } catch (error) {
    console.error("[LocationRoute]", error);
    return response.error(res, "Đã có lỗi xảy ra khi lấy danh sách thành phố", 500);
  }
});

module.exports = router;
