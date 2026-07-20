const tripRepository = require("./trip.repository");
const locationRepository = require("../location/location.repository");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const MAX_NIGHTS = 14; // lịch trình dài hơn không thực tế để sinh tự động

const parseDate = (s) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const validateTripInput = ({ startDate, endDate, numPeople, budgetTotal }, { isCreate }) => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);

  if (isCreate && (!start || !end)) {
    throw validationError("start_date và end_date là bắt buộc (YYYY-MM-DD)", 400);
  }
  if (start && end) {
    if (end <= start) {
      throw validationError("end_date phải sau start_date", 400);
    }
    const nights = (end - start) / 86_400_000;
    if (nights > MAX_NIGHTS) {
      throw validationError(`Chuyến đi tối đa ${MAX_NIGHTS} đêm`, 400);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start < today) {
      throw validationError("start_date không được ở quá khứ", 400);
    }
  }
  if (numPeople !== undefined) {
    const n = Number(numPeople);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      throw validationError("num_people phải là số nguyên từ 1 đến 20", 400);
    }
  }
  if (budgetTotal !== undefined && budgetTotal !== null) {
    const b = Number(budgetTotal);
    if (Number.isNaN(b) || b < 0) {
      throw validationError("budget_total phải là số không âm", 400);
    }
  }
};

const createTrip = async (userId, { cityCode, title, startDate, endDate, budgetTotal, numPeople }) => {
  if (!cityCode) {
    throw validationError("city_code là bắt buộc", 400);
  }
  validateTripInput({ startDate, endDate, numPeople, budgetTotal }, { isCreate: true });

  const location = await locationRepository.findByCityCode(cityCode);
  if (!location) {
    throw validationError(`Thành phố "${cityCode}" chưa được hỗ trợ`, 404);
  }

  const tripId = await tripRepository.createTrip({
    userId,
    locationId: location.id,
    title,
    startDate,
    endDate,
    budgetTotal,
    numPeople,
  });

  return tripRepository.findByIdWithLocation(tripId);
};

// Trả trip nếu tồn tại VÀ thuộc về user — 404 cho cả 2 trường hợp còn lại
// (không phân biệt "không tồn tại" và "của người khác" để tránh dò id)
const getOwnedTrip = async (userId, tripId) => {
  const trip = await tripRepository.findByIdWithLocation(tripId);
  if (!trip || trip.user_id !== userId) {
    throw validationError("Không tìm thấy chuyến đi", 404);
  }
  return trip;
};

const getMyTrips = async (userId, { page = 1, pageSize = 20 }) => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 50);

  const { rows, total } = await tripRepository.findByUser(userId, {
    limit: safePageSize,
    offset: (safePage - 1) * safePageSize,
  });

  return {
    trips: rows,
    pagination: { total, page: safePage, page_size: safePageSize, total_pages: Math.ceil(total / safePageSize) },
  };
};

const updateTrip = async (userId, tripId, { cityCode, title, startDate, endDate, budgetTotal, numPeople }) => {
  const trip = await getOwnedTrip(userId, tripId);

  if (trip.status !== "draft") {
    throw validationError("Chỉ sửa được chuyến đi ở trạng thái draft", 409);
  }

  // Validate với giá trị hợp nhất (giữ giá trị cũ nếu không gửi lên)
  validateTripInput(
    {
      startDate: startDate ?? trip.start_date,
      endDate: endDate ?? trip.end_date,
      numPeople,
      budgetTotal,
    },
    { isCreate: false }
  );

  let locationId;
  if (cityCode) {
    const location = await locationRepository.findByCityCode(cityCode);
    if (!location) {
      throw validationError(`Thành phố "${cityCode}" chưa được hỗ trợ`, 404);
    }
    locationId = location.id;
  }

  await tripRepository.updateTrip(tripId, {
    locationId,
    title,
    startDate,
    endDate,
    budgetTotal,
    numPeople,
  });

  return tripRepository.findByIdWithLocation(tripId);
};

const deleteTrip = async (userId, tripId) => {
  await getOwnedTrip(userId, tripId);
  await tripRepository.deleteTrip(tripId);
};

module.exports = { createTrip, getOwnedTrip, getMyTrips, updateTrip, deleteTrip };
