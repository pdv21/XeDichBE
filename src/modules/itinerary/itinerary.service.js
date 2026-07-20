const itineraryRepository = require("./itinerary.repository");
const jobRepository = require("./job.repository");
const { generateItinerary } = require("./planning.engine");
const tripService = require("../trip/trip.service");
const userService = require("../user/user.service");
const placeRepository = require("../place/place.repository");
const budgetService = require("../budget/budget.service");
const db = require("../../shared/config/database");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const MIN_ATTRACTIONS = 3; // dưới mức này lịch trình sinh ra vô nghĩa

// Lấy đủ thông tin location (toạ độ trung tâm + bán kính) cho engine
const getLocationGeo = async (locationId) => {
  const [rows] = await db.execute(
    "SELECT latitude, longitude, crawl_radius_m FROM locations WHERE id = ? LIMIT 1",
    [locationId]
  );
  return rows[0] ?? null;
};

// Nhóm activities phẳng thành cấu trúc ngày-theo-ngày cho response
const groupByDay = (rows, startDate) => {
  const days = [];
  for (const row of rows) {
    let day = days.find((d) => d.day_index === row.day_index);
    if (!day) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + row.day_index - 1);
      day = { day_index: row.day_index, date: date.toISOString().slice(0, 10), activities: [] };
      days.push(day);
    }
    day.activities.push({
      order: row.order_index,
      start_time: row.start_time,
      type: row.activity_type,
      score: row.score != null ? Number(row.score) : null,
      place: {
        id: row.place_id,
        name: row.name,
        name_vi: row.name_vi ?? null,
        category: row.category,
        kinds: row.kinds,
        address: row.address,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        rate: row.rate,
        description: row.description,
        description_vi: row.description_vi ?? null,
        image: row.image,
        visit_minutes: row.visit_minutes,
      },
    });
  }
  return days;
};

// ─── planTrip: POST /trips/:id/plan ──────────────────────────────────────────
const planTrip = async (userId, tripId) => {
  const trip = await tripService.getOwnedTrip(userId, tripId);

  const geo = await getLocationGeo(trip.location_id);
  if (!geo || geo.latitude == null) {
    throw validationError("Thành phố này chưa có toạ độ để sinh lịch trình", 409);
  }

  // Số ngày = số đêm + 1 (ngày đến và ngày về đều có hoạt động)
  const nights = Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86_400_000);
  const days = nights + 1;

  const preferences = await userService.getPreferences(userId);

  // Budget-aware planning: TÍNH NGÂN SÁCH TRƯỚC KHI XẾP LỊCH — lấy giá khách sạn
  // thật, trừ chi phí cố định, chọn khách sạn vừa túi và hạ pace nếu cần để tổng
  // nằm trong trips.budget_total. Kết quả pace hiệu lực đưa vào engine bên dưới.
  const fit = await budgetService.fitBudgetForPlanning(trip, preferences.pace ?? "moderate");
  const effectivePreferences = { ...preferences, pace: fit.effectivePace };

  // Data Aggregation: lấy toàn bộ places của thành phố từ DB (đã crawl sẵn)
  const [attractions, foods] = await Promise.all([
    placeRepository.findByLocation({ locationId: trip.location_id, category: "attraction", limit: 1000 }),
    placeRepository.findByLocation({ locationId: trip.location_id, category: "food", limit: 1000 }),
  ]);

  if (attractions.length < MIN_ATTRACTIONS) {
    throw validationError(
      "Thành phố này chưa đủ dữ liệu địa điểm để sinh lịch trình, vui lòng thử thành phố khác",
      409
    );
  }

  const activities = generateItinerary({
    attractions,
    foods,
    days,
    center: { lat: Number(geo.latitude), lon: Number(geo.longitude) },
    radiusKm: (geo.crawl_radius_m || 10000) / 1000,
    preferences: effectivePreferences,
  });

  if (activities.length === 0) {
    throw validationError("Không sinh được lịch trình từ dữ liệu hiện có", 500);
  }

  await itineraryRepository.saveItinerary(tripId, activities);

  // Lưu snapshot chi phí cùng lúc với lịch trình — frontend đọc kèm itinerary
  const budgetSummary = await budgetService.buildPlanBudgetSummary(fit);
  await jobRepository.saveTripBudgetSummary(tripId, budgetSummary);

  const saved = await itineraryRepository.findByTripId(tripId);
  return {
    trip_id: tripId,
    city: trip.city_name,
    start_date: trip.start_date,
    end_date: trip.end_date,
    budget_total: trip.budget_total,
    num_people: trip.num_people,
    budget_summary: budgetSummary,
    days: groupByDay(saved, trip.start_date),
    _preferences: effectivePreferences, // dùng nội bộ cho bước AI, controller không expose
  };
};

// ─── getItinerary: GET /trips/:id/itinerary ──────────────────────────────────
const getItinerary = async (userId, tripId) => {
  const trip = await tripService.getOwnedTrip(userId, tripId);

  const rows = await itineraryRepository.findByTripId(tripId);
  if (rows.length === 0) {
    throw validationError("Chuyến đi chưa có lịch trình — gọi POST /trips/:id/plan trước", 404);
  }

  const parseJson = (v) => {
    if (v == null) return null;
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return null; }
  };

  return {
    trip_id: tripId,
    city: trip.city_name,
    status: trip.status,
    start_date: trip.start_date,
    end_date: trip.end_date,
    ai_summary: parseJson(trip.ai_summary),
    budget_summary: parseJson(trip.budget_summary),
    days: groupByDay(rows, trip.start_date),
  };
};

module.exports = { planTrip, getItinerary };
