const itineraryRepository = require("./itinerary.repository");
const jobRepository = require("./job.repository");
const tripService = require("../trip/trip.service");
const userService = require("../user/user.service");
const placeRepository = require("../place/place.repository");
const budgetService = require("../budget/budget.service");
const feedbackInterpreter = require("./feedback.interpreter");
const db = require("../../shared/config/database");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const MIN_ATTRACTIONS = 3; // dưới mức này lịch trình sinh ra vô nghĩa

const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

const EMPTY_ADJUSTMENTS = { exclude_place_ids: [], pace: null, interests_add: [], interests_remove: [], history: [] };

// Áp interests_add/remove (đã cộng dồn qua nhiều lần góp ý) lên interests gốc
// của user_preferences — CHỈ dùng khi sinh lịch trình cho trip này, không ghi
// ngược lại user_preferences (mỗi trip có thể điều chỉnh khác nhau).
const applyInterestDeltas = (baseInterests, adjustments) => {
  let interests = Array.isArray(baseInterests) ? [...baseInterests] : [];
  for (const tag of adjustments.interests_remove ?? []) {
    interests = interests.filter((i) => i !== tag);
  }
  for (const tag of adjustments.interests_add ?? []) {
    if (!interests.includes(tag)) interests.push(tag);
  }
  return interests;
};

// Lấy đủ thông tin location (toạ độ trung tâm + bán kính) cho engine
const getLocationGeo = async (locationId) => {
  const [rows] = await db.execute(
    "SELECT latitude, longitude, crawl_radius_m FROM locations WHERE id = ? LIMIT 1",
    [locationId]
  );
  return rows[0] ?? null;
};

// Nhóm activities phẳng thành cấu trúc ngày-theo-ngày cho response. Gắn kèm
// estimated_cost/cost_is_estimated cho từng hoạt động (per person) — dùng chung
// budgetService.resolveActivityCost để khớp đúng với tổng trong budget_summary,
// tránh 2 nơi tính ra 2 con số khác nhau.
const groupByDay = (rows, startDate, trip) => {
  const days = [];
  for (const row of rows) {
    let day = days.find((d) => d.day_index === row.day_index);
    if (!day) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + row.day_index - 1);
      day = { day_index: row.day_index, date: date.toISOString().slice(0, 10), activities: [] };
      days.push(day);
    }
    const { cost, is_estimated } = budgetService.resolveActivityCost(
      { activity_type: row.activity_type, place: { avg_cost: row.avg_cost } },
      trip
    );
    day.activities.push({
      order: row.order_index,
      start_time: row.start_time,
      type: row.activity_type,
      score: row.score != null ? Number(row.score) : null,
      estimated_cost: cost,
      cost_is_estimated: is_estimated,
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

  const preferences = await userService.getPreferences(userId);

  // Áp itinerary_adjustments (nếu có, từ POST /trips/:id/adjust) lên preferences
  // — CHỈ cho lần sinh lịch trình này, không đổi user_preferences toàn cục.
  const adjustments = parseJson(trip.itinerary_adjustments) ?? EMPTY_ADJUSTMENTS;
  const adjustedPreferences = {
    ...preferences,
    pace: adjustments.pace ?? preferences.pace,
    interests: applyInterestDeltas(preferences.interests, adjustments),
  };
  const excludedIds = new Set(adjustments.exclude_place_ids ?? []);

  // Data Aggregation: lấy toàn bộ places của thành phố từ DB (đã crawl sẵn),
  // loại các điểm user đã yêu cầu bỏ qua trong lần góp ý trước
  const [attractionsRaw, foodsRaw] = await Promise.all([
    placeRepository.findByLocation({ locationId: trip.location_id, category: "attraction", limit: 1000 }),
    placeRepository.findByLocation({ locationId: trip.location_id, category: "food", limit: 1000 }),
  ]);
  const attractions = attractionsRaw.filter((p) => !excludedIds.has(p.id));
  const foods = foodsRaw.filter((p) => !excludedIds.has(p.id));

  if (attractions.length < MIN_ATTRACTIONS) {
    throw validationError(
      "Thành phố này chưa đủ dữ liệu địa điểm để sinh lịch trình, vui lòng thử thành phố khác",
      409
    );
  }

  // Budget-aware planning: với mỗi pace ứng viên, fitBudgetForPlanning tự sinh
  // THẬT lịch trình (generateItinerary) rồi tính chi phí ăn/vé/di chuyển từ đúng
  // route đó — không còn ước lượng qua số lượng. Phần ngân sách còn lại sau chi
  // phí cố định dùng để chọn khách sạn, hạ pace dần nếu cần để vừa trips.budget_total.
  // Lịch trình được chọn trả kèm trong fit.activities — dùng thẳng, không sinh lại.
  const fit = await budgetService.fitBudgetForPlanning(trip, adjustedPreferences.pace ?? "moderate", {
    attractions,
    foods,
    center: { lat: Number(geo.latitude), lon: Number(geo.longitude) },
    radiusKm: (geo.crawl_radius_m || 10000) / 1000,
    preferences: adjustedPreferences,
  });
  const effectivePreferences = { ...adjustedPreferences, pace: fit.effectivePace };

  const activities = fit.activities;
  if (!activities || activities.length === 0) {
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
    days: groupByDay(saved, trip.start_date, trip),
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

  const adjustments = parseJson(trip.itinerary_adjustments);

  return {
    trip_id: tripId,
    city: trip.city_name,
    status: trip.status,
    start_date: trip.start_date,
    end_date: trip.end_date,
    ai_summary: parseJson(trip.ai_summary),
    budget_summary: parseJson(trip.budget_summary),
    days: groupByDay(rows, trip.start_date, trip),
    // Ghi chú thay đổi gần nhất từ POST /trips/:id/adjust — FE hiển thị xác nhận
    // "đã áp dụng góp ý của bạn" sau khi lịch trình mới sinh xong
    last_adjustment_note: adjustments?.history?.length
      ? adjustments.history[adjustments.history.length - 1].changes_summary
      : null,
  };
};

// ─── submitFeedback: POST /trips/:id/adjust ──────────────────────────────────
// Diễn giải góp ý tự do của user qua Gemini (functional — lỗi phải throw, không
// best-effort) rồi CỘNG DỒN vào trips.itinerary_adjustments. Không tự sinh lại
// lịch trình ở đây — controller enqueue lại đúng job 'trip-plan' sẵn có
// (planTrip ở trên sẽ đọc itinerary_adjustments vừa lưu khi worker chạy).
const submitFeedback = async (userId, tripId, feedback) => {
  const trip = await tripService.getOwnedTrip(userId, tripId);

  const rows = await itineraryRepository.findByTripId(tripId);
  if (rows.length === 0) {
    throw validationError("Chuyến đi chưa có lịch trình để chỉnh sửa — sinh lịch trình trước", 409);
  }

  const preferences = await userService.getPreferences(userId);
  const current = parseJson(trip.itinerary_adjustments) ?? EMPTY_ADJUSTMENTS;
  const currentPace = current.pace ?? preferences.pace ?? "moderate";
  const currentInterests = applyInterestDeltas(preferences.interests, current);

  const delta = await feedbackInterpreter.interpretFeedback({
    feedback,
    currentPace,
    currentInterests,
    activities: rows.map((r) => ({
      place_id: r.place_id, day_index: r.day_index, activity_type: r.activity_type,
      name: r.name, name_vi: r.name_vi,
    })),
  });

  const interestsAdd = new Set(current.interests_add ?? []);
  const interestsRemove = new Set(current.interests_remove ?? []);
  for (const tag of delta.interests_remove) { interestsAdd.delete(tag); interestsRemove.add(tag); }
  for (const tag of delta.interests_add) { interestsRemove.delete(tag); interestsAdd.add(tag); }

  const merged = {
    exclude_place_ids: [...new Set([...(current.exclude_place_ids ?? []), ...delta.exclude_place_ids])],
    pace: delta.pace ?? current.pace ?? null,
    interests_add: [...interestsAdd],
    interests_remove: [...interestsRemove],
    history: [
      ...(current.history ?? []),
      { feedback: String(feedback).slice(0, 500), applied_at: new Date().toISOString(), changes_summary: delta.reply_note },
    ].slice(-10), // giữ tối đa 10 lần gần nhất, đủ cho lịch sử hiển thị
  };

  await jobRepository.saveTripAdjustments(tripId, merged);
  return { changes_summary: delta.reply_note };
};

module.exports = { planTrip, getItinerary, submitFeedback };
