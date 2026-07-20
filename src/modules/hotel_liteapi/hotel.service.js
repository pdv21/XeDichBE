const hotelRepository = require("./hotel.repository");

const MAX_LIST_LIMIT = 50;

const formatOccupancies = (occupancies) =>
  occupancies.map((room) => ({
    adults: room.adults ?? 1,
    children: (room.children || []).map((age) =>
      typeof age === "number" ? { age } : age
    ),
  }));

// List view không cần mô tả HTML dài + accessibilityAttributes (phần lớn null) —
// hai field này chiếm phần lớn dung lượng response, chỉ cần thiết ở trang detail.
const slimForList = (hotel) => {
  const { hotelDescription, accessibilityAttributes, ...rest } = hotel;
  return rest;
};

const searchByCity = async ({ countryCode, cityName, limit = 20, offset = 0 }) => {
  if (!countryCode || !cityName) {
    throw new Error("countryCode và cityName là bắt buộc");
  }

  const cappedLimit = Math.min(Number(limit) || 20, MAX_LIST_LIMIT);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const hotels = await hotelRepository.findByCity({
    countryCode,
    cityName,
    limit: cappedLimit,
    offset: safeOffset,
  });

  return { total: hotels.length, hotels: hotels.map(slimForList) };
};

const searchByIds = async (rawIds) => {
  if (!rawIds) {
    throw new Error("ids là bắt buộc (VD: ?ids=lp1234,lp5678)");
  }

  const hotelIds = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_LIMIT);

  if (hotelIds.length === 0) {
    throw new Error("ids không hợp lệ");
  }

  const hotels = await hotelRepository.findByIds(hotelIds);
  return { total: hotels.length, hotels: hotels.map(slimForList) };
};

const getDetail = async (hotelId) => {
  const hotel = await hotelRepository.findById(hotelId);
  return { hotel };
};

const getRates = async ({
  hotelIds,
  cityName,
  countryCode,
  checkin,
  checkout,
  occupancies,
  currency = "VND",
  guestNationality = "VN",
  timeout = 10,
  limit
}) => {
  if (!checkin || !checkout) {
    throw new Error("checkin và checkout là bắt buộc");
  }
  if (!Array.isArray(occupancies) || occupancies.length === 0) {
    throw new Error("occupancies là bắt buộc");
  }
  if (!hotelIds?.length && (!cityName || !countryCode)) {
    throw new Error("Cần cung cấp hotelIds HOẶC (cityName + countryCode)");
  }

  // Chặn client truyền timeout/limit bất thường (giữ server không phải chờ
  // upstream quá lâu, và không forward limit vô tội vạ sang LiteAPI)
  const safeTimeout = Math.min(Math.max(Number(timeout) || 10, 1), 30);
  const cappedLimit = limit ? Math.min(Number(limit), MAX_LIST_LIMIT) : undefined;

  const payload = {
    checkin,
    checkout,
    occupancies: formatOccupancies(occupancies),
    currency,
    guestNationality,
    timeout: safeTimeout,
    ...(cappedLimit && { limit: cappedLimit }),
    ...(hotelIds?.length ? { hotelIds } : { cityName, countryCode }),
  };

  const rates = await hotelRepository.getRates(payload);
  return { total: rates.length, rates };
};

module.exports = { searchByCity, searchByIds, getDetail, getRates };
