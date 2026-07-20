const placeRepository = require("./place.repository");
const locationRepository = require("../location/location.repository");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const VALID_CATEGORIES = ["attraction", "food"];
const MAX_LIMIT = 100;

const getPlacesByCity = async ({ cityCode, category, minRate, limit = 50, offset = 0 }) => {
  if (!cityCode) {
    throw validationError("city_code là bắt buộc", 400);
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw validationError(`category phải là: ${VALID_CATEGORIES.join(", ")}`, 400);
  }

  const location = await locationRepository.findByCityCode(cityCode);
  if (!location) {
    throw validationError(`Thành phố "${cityCode}" chưa được hỗ trợ`, 404);
  }

  const filters = {
    locationId: location.id,
    category,
    minRate: minRate != null ? Number(minRate) : undefined,
  };

  const [places, total] = await Promise.all([
    placeRepository.findByLocation({
      ...filters,
      limit: Math.min(Number(limit) || 50, MAX_LIMIT),
      offset: Number(offset) || 0,
    }),
    placeRepository.countByLocation(filters),
  ]);

  return { total, city: location.city_name, places };
};

module.exports = { getPlacesByCity };
