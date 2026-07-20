const placeService = require("./place.service");
const response = require("../../shared/utils/response");

const getPlaces = async (req, res) => {
  try {
    const { city_code, category, min_rate, limit, offset } = req.query;
    const result = await placeService.getPlacesByCity({
      cityCode: city_code,
      category,
      minRate: min_rate,
      limit,
      offset,
    });
    return response.paginated(res, result.places, { total: result.total, city: result.city }, "Lấy danh sách địa điểm thành công");
  } catch (error) {
    if (error.statusCode) {
      return response.error(res, error.message, error.statusCode);
    }
    console.error("[PlaceController]", error);
    return response.error(res, "Đã có lỗi xảy ra khi lấy địa điểm", 500);
  }
};

module.exports = { getPlaces };
