const tripService = require("../trip/trip.service");
const hotelService = require("../hotel_liteapi/hotel.service");
const flightService = require("../flight/flight.service");
const { generateItinerary, distanceKm } = require("../itinerary/planning.engine");
const db = require("../../shared/config/database");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// Toàn bộ budget tính bằng VND. Khách sạn lấy giá VND trực tiếp từ LiteAPI;
// vé bay Ignav chỉ trả USD → quy đổi qua tỷ giá USD_VND_RATE (env, cập nhật
// tay khi tỷ giá biến động mạnh — đồ án không cần API tỷ giá real-time).
//
// Ăn uống + vé tham quan + di chuyển giờ tính từ DỮ LIỆU THỰC của lịch trình đã
// sinh (quán ăn/điểm tham quan cụ thể được chọn, khoảng cách di chuyển thật giữa
// các điểm) thay vì hằng số cố định — xem computeMealCostFromActivities,
// computeAttractionCostFromActivities, computeTransportFromActivities bên dưới.
// Các hằng số *_FALLBACK_VND chỉ còn dùng khi:
//   - places.avg_cost chưa được enrich (place.enrich.job.js#enrichCostsFromGemini
//     chưa chạy tới điểm đó, hoặc Gemini lỗi) → fallback theo điểm
//   - bữa sáng: engine không xếp quán cụ thể (giả định ăn gần khách sạn)
//   - GET /trips/:id/budget gọi TRƯỚC khi trip có lịch trình (chưa có route thật)
const MEAL_COST = Number(process.env.BUDGET_MEAL_COST_VND) || 100_000;
const ATTRACTION_FEE_FALLBACK_VND = Number(process.env.BUDGET_ATTRACTION_FEE_VND) || 50_000;
const TRANSPORT_FALLBACK_VND_PER_DAY = Number(process.env.BUDGET_TRANSPORT_VND_PER_DAY) || 250_000;

// Cước di chuyển nội thành ước tính theo mô hình Grab thực tế: phí mở cửa + phí/km.
// Xe máy khi nhóm nhỏ (mỗi người 1 xe), ô tô 4 chỗ khi nhóm >2 (ceil(n/4) xe).
const TRANSPORT_BIKE_BASE_VND = Number(process.env.BUDGET_TRANSPORT_BIKE_BASE_VND) || 13_000;
const TRANSPORT_BIKE_PER_KM_VND = Number(process.env.BUDGET_TRANSPORT_BIKE_PER_KM_VND) || 4_300;
const TRANSPORT_CAR_BASE_VND = Number(process.env.BUDGET_TRANSPORT_CAR_BASE_VND) || 20_000;
const TRANSPORT_CAR_PER_KM_VND = Number(process.env.BUDGET_TRANSPORT_CAR_PER_KM_VND) || 12_000;
// Haversine đo đường chim bay, đường thật (có khúc cua, một chiều...) luôn dài hơn
const TRANSPORT_ROAD_FACTOR = Number(process.env.BUDGET_TRANSPORT_ROAD_FACTOR) || 1.3;

const USD_VND_RATE = Number(process.env.USD_VND_RATE) || 26_500;

// VND không có số lẻ — làm tròn về nghìn đồng cho dễ đọc
const roundVnd = (n) => Math.round(n / 1000) * 1000;

// User có thể tự chọn giá/bữa lúc tạo trip (trips.meal_cost_vnd) — ghi đè mặc định hệ thống
const resolveMealCost = (trip) => (trip.meal_cost_vnd != null ? Number(trip.meal_cost_vnd) : MEAL_COST);

// mysql2 trả cột DATE thành JS Date object — String().slice(0,10) sẽ ra
// "Sun Sep 20" chứ KHÔNG phải "2026-09-20". Dùng local getters cho đúng.
const toDateStr = (d) => {
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// mysql2 có thể trả cột JSON dạng object hoặc string tuỳ version — parse an toàn
const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return null; }
};

// ─── Chi phí thực từ danh sách activity {day_index, order_index, activity_type, place} ──
// Dùng chung bởi fitBudgetForPlanning (lịch trình vừa sinh, chưa lưu DB) và
// estimateFromItinerary (lịch trình đã lưu, đọc lại từ trip_activities) — cả 2
// đều map dữ liệu về đúng shape này trước khi gọi.

// Xe máy (nhóm ≤2, mỗi người 1 xe) hoặc ô tô 4 chỗ (ceil(n/4) xe) cho nhóm lớn hơn
const vehicleFare = (numPeople) => {
  if (numPeople <= 2) {
    return { base: TRANSPORT_BIKE_BASE_VND * numPeople, perKm: TRANSPORT_BIKE_PER_KM_VND * numPeople };
  }
  const cars = Math.ceil(numPeople / 4);
  return { base: TRANSPORT_CAR_BASE_VND * cars, perKm: TRANSPORT_CAR_PER_KM_VND * cars };
};

// Tổng quãng đường thật trong từng ngày (nối các điểm theo đúng order_index đã xếp)
// × cước xe theo số người — thay cho hằng số cố định/ngày trước đây
const computeTransportFromActivities = (activities, numPeople) => {
  const byDay = new Map();
  for (const a of activities) {
    if (!byDay.has(a.day_index)) byDay.set(a.day_index, []);
    byDay.get(a.day_index).push(a);
  }

  const fare = vehicleFare(numPeople);
  let totalKm = 0;
  let total = 0;
  for (const dayActs of byDay.values()) {
    const ordered = [...dayActs].sort((a, b) => a.order_index - b.order_index);
    let km = 0;
    for (let i = 1; i < ordered.length; i++) {
      const p1 = ordered[i - 1].place;
      const p2 = ordered[i].place;
      km += distanceKm(Number(p1.latitude), Number(p1.longitude), Number(p2.latitude), Number(p2.longitude));
    }
    km *= TRANSPORT_ROAD_FACTOR;
    totalKm += km;
    total += fare.base + km * fare.perKm;
  }

  return { total: roundVnd(total), distance_km: Math.round(totalKm * 10) / 10 };
};

// Chi phí ước tính (VND/người) cho MỘT activity cụ thể — nguồn sự thật duy nhất
// dùng cả để cộng tổng (2 hàm compute* bên dưới) LẪN hiển thị per-item trong
// GET /trips/:id/itinerary (xem itinerary.service.js#groupByDay), đảm bảo tổng
// luôn khớp với từng dòng hiển thị. is_estimated=true nghĩa là avg_cost chưa
// enrich (hoặc bữa sáng — không gắn quán cụ thể) nên đang dùng giá fallback.
const resolveActivityCost = (activity, trip) => {
  const known = activity.place.avg_cost;
  if (known != null) return { cost: Number(known), is_estimated: false };
  const fallback = activity.activity_type === "meal" ? resolveMealCost(trip) : ATTRACTION_FEE_FALLBACK_VND;
  return { cost: fallback, is_estimated: true };
};

// Vé tham quan: cộng avg_cost thật của từng điểm visit đã enrich (Gemini estimate,
// xem place.enrich.job.js#enrichCostsFromGemini); điểm chưa có giá → fallback flat
const computeAttractionCostFromActivities = (activities, numPeople, trip) => {
  const visits = activities.filter((a) => a.activity_type === "visit");
  let known = 0;
  let estimatedTotal = 0;
  for (const v of visits) {
    const { cost, is_estimated } = resolveActivityCost(v, trip);
    estimatedTotal += cost;
    if (!is_estimated) known += cost;
  }
  return {
    count: visits.length,
    known_cost: roundVnd(known * numPeople),
    estimated_total: roundVnd(estimatedTotal * numPeople),
  };
};

// Ăn uống: trưa+tối dùng avg_cost thật của quán đã chọn (fallback flat nếu quán
// chưa có giá); bữa sáng không gắn quán cụ thể trong engine (ăn gần khách sạn) →
// luôn dùng giá ước tính (mặc định hệ thống hoặc trip.meal_cost_vnd nếu user set)
const computeMealCostFromActivities = (activities, days, numPeople, trip) => {
  const mealActs = activities.filter((a) => a.activity_type === "meal");
  const fallback = resolveMealCost(trip);

  let total = mealActs.reduce((s, m) => s + resolveActivityCost(m, trip).cost, 0);
  total += days * fallback; // bữa sáng

  const mealCount = (mealActs.length + days) * numPeople;
  return { count: mealCount, total: roundVnd(total * numPeople) };
};

// ─── Khách sạn: giá thật từ LiteAPI ──────────────────────────────────────────
// Trả danh sách [{hotelId, price}] sort tăng dần theo giá cả kỳ ở — dùng chung
// cho cả estimateBudget (3 mức tham khảo) và fitBudgetForPlanning (chọn theo budget)
const getHotelOptionsForTrip = async (trip) => {
  // Ở ghép 2 người/phòng — sát thực tế hơn nhét cả nhóm vào 1 phòng
  const numRooms = Math.ceil(trip.num_people / 2);
  const occupancies = Array.from({ length: numRooms }, (_, i) => ({
    adults: i === numRooms - 1 && trip.num_people % 2 === 1 ? 1 : 2,
  }));

  try {
    const { rates } = await hotelService.getRates({
      cityName: trip.city_name,
      countryCode: "VN",
      checkin: toDateStr(trip.start_date),
      checkout: toDateStr(trip.end_date),
      occupancies,
      currency: "VND",
      limit: 50,
    });

    // Giá cả kỳ ở của mỗi hotel = roomType rẻ nhất của hotel đó
    const options = rates
      .map((h) => {
        const prices = (h.roomTypes ?? [])
          .map((rt) => rt.offerRetailRate?.amount)
          .filter((p) => typeof p === "number" && p > 0);
        return prices.length > 0 ? { hotelId: h.hotelId, price: Math.min(...prices) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.price - b.price);

    return { options, rooms: numRooms };
  } catch (err) {
    console.warn("[Budget] Lỗi lấy giá khách sạn:", err.message);
    return { options: [], rooms: numRooms };
  }
};

// Đồng nhất với card "Chi phí dự kiến": nếu trip đã sinh lịch trình thì
// trips.budget_summary có khách sạn ĐÃ CHỌN theo ngân sách — ưu tiên tính tổng
// theo giá live hiện tại của đúng khách sạn đó (hết phòng thì dùng giá snapshot
// lúc plan). Chưa plan → fallback mức trung vị thị trường như cũ.
// Các mức rẻ nhất/trung bình/cao nhất luôn giữ lại làm tham khảo.
const estimateHotel = async (trip) => {
  const { options, rooms } = await getHotelOptionsForTrip(trip);
  const sel = parseJson(trip.budget_summary)?.hotel?.selected;

  const hotel = { options_found: options.length, rooms };
  if (options.length > 0) {
    const prices = options.map((o) => o.price);
    hotel.budget = roundVnd(Math.min(...prices));
    hotel.standard = roundVnd(median(prices));
    hotel.premium = roundVnd(Math.max(...prices));
  }

  if (sel?.hotel_id && sel.price != null) {
    const live = options.find((o) => o.hotelId === sel.hotel_id);
    hotel.selected = {
      hotel_id: sel.hotel_id,
      name: sel.name ?? null,
      price: roundVnd(live ? live.price : Number(sel.price)),
      live_price: !!live, // false = không còn giá live hôm nay, đang dùng giá lúc sinh lịch trình
    };
  }

  return hotel.selected || options.length > 0 ? hotel : null;
};

// ─── Vé bay khứ hồi (optional — cần query origin) ────────────────────────────
const estimateFlight = async (trip, originAirport) => {
  const [locRows] = await db.execute(
    "SELECT airport_code FROM locations WHERE id = ? LIMIT 1",
    [trip.location_id]
  );
  const destAirport = locRows[0]?.airport_code;
  if (!destAirport) {
    return { available: false, note: "Thành phố này chưa có mã sân bay" };
  }
  if (originAirport === destAirport) {
    return { available: false, note: "Điểm đi và điểm đến cùng sân bay" };
  }

  const [outbound, inbound] = await Promise.all([
    flightService.getCheapestOneWayPrice({
      origin: originAirport,
      destination: destAirport,
      departureDate: toDateStr(trip.start_date),
      adults: trip.num_people,
    }),
    flightService.getCheapestOneWayPrice({
      origin: destAirport,
      destination: originAirport,
      departureDate: toDateStr(trip.end_date),
      adults: trip.num_people,
    }),
  ]);

  if (outbound == null && inbound == null) {
    return { available: false, note: "Không tìm thấy chuyến bay phù hợp" };
  }

  // Ignav trả giá USD — quy đổi sang VND theo tỷ giá cấu hình
  const perPersonVnd = ((outbound ?? 0) + (inbound ?? 0)) * USD_VND_RATE;
  return {
    available: true,
    from: originAirport,
    to: destAirport,
    outbound_per_person: outbound != null ? roundVnd(outbound * USD_VND_RATE) : null,
    inbound_per_person: inbound != null ? roundVnd(inbound * USD_VND_RATE) : null,
    exchange_rate: USD_VND_RATE,
    total: roundVnd(perPersonVnd * trip.num_people),
    ...(outbound == null || inbound == null
      ? { note: "Chỉ tìm thấy vé 1 chiều — tổng chưa gồm chiều còn lại" }
      : {}),
  };
};

// ─── Ăn uống + vé tham quan + di chuyển: từ lịch trình đã sinh (nếu có) ───────
// Đọc lại đúng route đã lưu (thứ tự ngày/điểm + toạ độ + avg_cost thật của từng
// quán/điểm) rồi tái dùng chung 3 hàm compute* — kết quả khớp với lúc sinh lịch
// trình (fitBudgetForPlanning) vì cùng công thức, khác nguồn: đây đọc DB, kia
// đọc thẳng output generateItinerary.
const estimateFromItinerary = async (trip, days) => {
  const [rows] = await db.execute(
    `SELECT ta.day_index, ta.order_index, ta.activity_type, p.avg_cost, p.latitude, p.longitude
     FROM trip_activities ta JOIN places p ON ta.place_id = p.id
     WHERE ta.trip_id = ?
     ORDER BY ta.day_index ASC, ta.order_index ASC`,
    [trip.id]
  );

  if (rows.length === 0) {
    // Chưa sinh lịch trình → chưa có route thật, ước theo mặc định thô:
    // 3 bữa/ngày, 3 điểm tham quan/ngày, transport flat/ngày
    const mealCost = resolveMealCost(trip);
    return {
      has_itinerary: false,
      meals: {
        count: days * 3 * trip.num_people,
        total: roundVnd(days * 3 * trip.num_people * mealCost),
      },
      attractions: {
        count: days * 3,
        known_cost: 0,
        estimated_total: roundVnd(days * 3 * trip.num_people * ATTRACTION_FEE_FALLBACK_VND),
      },
      transport: { total: roundVnd(days * TRANSPORT_FALLBACK_VND_PER_DAY), distance_km: null },
    };
  }

  const activities = rows.map((r) => ({
    day_index: r.day_index,
    order_index: r.order_index,
    activity_type: r.activity_type,
    place: { avg_cost: r.avg_cost, latitude: r.latitude, longitude: r.longitude },
  }));

  return {
    has_itinerary: true,
    meals: computeMealCostFromActivities(activities, days, trip.num_people, trip),
    attractions: computeAttractionCostFromActivities(activities, trip.num_people, trip),
    transport: computeTransportFromActivities(activities, trip.num_people),
  };
};

// ─── fitBudgetForPlanning — dùng bởi itinerary khi sinh lịch trình ────────────
// Tính TRƯỚC KHI lưu lịch: với mỗi pace ứng viên, chạy THẬT generateItinerary
// (thuật toán thuần, không I/O — rẻ để gọi lặp lại) rồi tính chi phí ăn/vé/di
// chuyển từ ĐÚNG route+quán+điểm vừa sinh (xem 3 hàm compute* ở trên) thay vì suy
// ra từ số lượng ước tính. Phần ngân sách còn lại sau chi phí cố định dùng để
// chọn khách sạn phù hợp. Nếu pace user muốn làm tổng vượt budget → tự hạ pace
// (packed→moderate→relaxed) và THỬ LẠI TOÀN BỘ (route đổi theo số điểm/ngày nên
// chi phí đi lại/ăn uống cũng đổi theo, không chỉ số điểm tham quan).
// Lịch trình được chọn ở đây trả kèm trong `activities` — itinerary.service.js
// dùng thẳng, không cần sinh lại lần 2.
// Vé bay KHÔNG tính ở đây (trip không lưu điểm xuất phát) — có ghi chú trong summary.
const PACE_DOWNGRADE = { packed: "moderate", moderate: "relaxed", relaxed: null };
// Chọn khách sạn đắt nhất còn ≤ 85% ngân sách còn lại (chừa 15% dự phòng);
// nếu không có thì lấy phương án rẻ nhất vừa túi
const HOTEL_BUDGET_RATIO = 0.85;

const pickHotel = (options, remaining) => {
  const affordable = options.filter((o) => o.price <= remaining);
  if (affordable.length === 0) return null;
  const comfy = affordable.filter((o) => o.price <= remaining * HOTEL_BUDGET_RATIO);
  return (comfy.length > 0 ? comfy : affordable).at(-1); // options đã sort tăng dần
};

// Sinh thử lịch trình cho 1 pace + tính chi phí thật từ kết quả đó
const tryPace = (pace, days, trip, engineInputs) => {
  const activities = generateItinerary({
    attractions: engineInputs.attractions,
    foods: engineInputs.foods,
    days,
    center: engineInputs.center,
    radiusKm: engineInputs.radiusKm,
    preferences: { ...engineInputs.preferences, pace },
  });
  const costs = {
    meals: computeMealCostFromActivities(activities, days, trip.num_people, trip),
    attractions: computeAttractionCostFromActivities(activities, trip.num_people, trip),
    transport: computeTransportFromActivities(activities, trip.num_people),
  };
  return { activities, costs };
};

// engineInputs = { attractions, foods, center, radiusKm, preferences } — nguyên liệu
// cho generateItinerary, itinerary.service.js đã fetch sẵn (tránh query lại 2 lần)
const fitBudgetForPlanning = async (trip, wishedPace = "moderate", engineInputs) => {
  const nights = Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86_400_000);
  const days = nights + 1;
  const budgetTotal = trip.budget_total != null ? Number(trip.budget_total) : null;
  const warnings = [];

  const { options, rooms } = await getHotelOptionsForTrip(trip);
  const prices = options.map((o) => o.price);

  // Không có ngân sách → giữ nguyên pace, gợi ý khách sạn mức trung vị
  if (budgetTotal == null) {
    const { activities, costs } = tryPace(wishedPace, days, trip, engineInputs);
    const selected = options.length > 0
      ? options[Math.floor(options.length / 2)]
      : null;
    return { effectivePace: wishedPace, wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings, activities };
  }

  // Thử pace user muốn, hạ dần nếu tổng vượt budget
  let pace = wishedPace;
  let lastAttempt = null;
  while (pace) {
    const attempt = tryPace(pace, days, trip, engineInputs);
    lastAttempt = { ...attempt, pace };
    const { costs } = attempt;
    const fixed = costs.meals.total + costs.attractions.estimated_total + costs.transport.total;
    const remaining = budgetTotal - fixed;
    const selected = pickHotel(options, remaining);

    if (selected || options.length === 0) {
      if (pace !== wishedPace) {
        warnings.push(`Đã giảm nhịp độ từ "${wishedPace}" xuống "${pace}" để phù hợp ngân sách`);
      }
      if (options.length === 0) {
        warnings.push("Không lấy được giá khách sạn — chi phí khách sạn chưa gồm trong tổng");
      }
      return { effectivePace: pace, wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings, activities: attempt.activities };
    }
    pace = PACE_DOWNGRADE[pace];
  }

  // Đến relaxed + khách sạn rẻ nhất vẫn vượt budget → trả phương án tối thiểu kèm cảnh báo
  const { activities, costs } = lastAttempt.pace === "relaxed" ? lastAttempt : tryPace("relaxed", days, trip, engineInputs);
  const selected = options[0] ?? null;
  const minTotal = costs.meals.total + costs.attractions.estimated_total + costs.transport.total + (selected?.price ?? 0);
  warnings.push(
    `Ngân sách ${roundVnd(budgetTotal).toLocaleString("vi-VN")}đ quá thấp — phương án tiết kiệm nhất cũng cần ~${roundVnd(minTotal).toLocaleString("vi-VN")}đ`
  );
  if (wishedPace !== "relaxed") {
    warnings.push(`Đã giảm nhịp độ từ "${wishedPace}" xuống "relaxed" để tiết kiệm tối đa`);
  }
  return { effectivePace: "relaxed", wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings, activities };
};

// Ghép fit thành summary JSON lưu vào trips.budget_summary (đọc kèm itinerary)
const buildPlanBudgetSummary = async (fit) => {
  const hotelInfo = { selected: null, options_found: fit.options.length, rooms: fit.rooms };

  if (fit.selected) {
    // Lấy tên/sao từ bảng hotels đã crawl (có thể miss nếu hotel không nằm trong top crawl)
    const [rows] = await db.execute(
      "SELECT name, star_rating FROM hotels WHERE hotel_id = ? LIMIT 1",
      [fit.selected.hotelId]
    );
    hotelInfo.selected = {
      hotel_id: fit.selected.hotelId,
      name: rows[0]?.name ?? null,
      star_rating: rows[0]?.star_rating != null ? Number(rows[0].star_rating) : null,
      price: roundVnd(fit.selected.price),
    };
  }
  if (fit.prices.length > 0) {
    hotelInfo.cheapest = roundVnd(Math.min(...fit.prices));
    hotelInfo.median = roundVnd(median(fit.prices));
  }

  const hotelCost = fit.selected ? roundVnd(fit.selected.price) : 0;
  const total = roundVnd(
    hotelCost + fit.costs.meals.total + fit.costs.attractions.estimated_total + fit.costs.transport.total
  );

  return {
    currency: "VND",
    requested_pace: fit.wishedPace,
    effective_pace: fit.effectivePace,
    hotel: hotelInfo,
    meals: fit.costs.meals,
    attractions: fit.costs.attractions,
    local_transport: fit.costs.transport,
    total_estimate: total,
    budget_total: fit.budgetTotal,
    ...(fit.budgetTotal != null && {
      within_budget: total <= fit.budgetTotal,
      difference: roundVnd(fit.budgetTotal - total),
    }),
    warnings: fit.warnings,
    note: "Chưa gồm vé máy bay — dùng mục \"Ước tính chi phí\" để tính thêm vé bay (cùng khách sạn đã chọn ở đây)",
  };
};

// ─── GET /trips/:id/budget ────────────────────────────────────────────────────
const estimateBudget = async (userId, tripId, { origin } = {}) => {
  const trip = await tripService.getOwnedTrip(userId, tripId);

  const nights = Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86_400_000);
  const days = nights + 1;

  const [hotel, activityCosts, flight] = await Promise.all([
    estimateHotel(trip),
    estimateFromItinerary(trip, days),
    origin ? estimateFlight(trip, String(origin).toUpperCase()) : Promise.resolve(null),
  ]);

  // Tổng ưu tiên khách sạn đã chọn khi plan (đồng nhất với budget_summary);
  // chưa plan thì theo mức trung vị; không có giá nào thì bỏ qua thành phần đó
  const hotelCost = hotel ? (hotel.selected?.price ?? hotel.standard ?? 0) : 0;
  const flightCost = flight?.available ? flight.total : 0;
  const total = roundVnd(
    hotelCost + flightCost + activityCosts.meals.total +
    activityCosts.attractions.estimated_total + activityCosts.transport.total
  );

  const budgetTotal = trip.budget_total != null ? Number(trip.budget_total) : null;

  return {
    trip_id: trip.id,
    city: trip.city_name,
    nights,
    days,
    num_people: trip.num_people,
    currency: "VND",
    breakdown: {
      hotel: hotel ?? { note: "Không lấy được giá khách sạn lúc này" },
      flight: flight ?? { note: "Truyền ?origin=HAN (mã sân bay đi) để ước tính vé bay" },
      meals: activityCosts.meals,
      attractions: activityCosts.attractions,
      local_transport: activityCosts.transport,
    },
    has_itinerary: activityCosts.has_itinerary,
    total_estimate: total,
    budget_total: budgetTotal,
    ...(budgetTotal != null && {
      within_budget: total <= budgetTotal,
      difference: roundVnd(budgetTotal - total),
    }),
  };
};

module.exports = { estimateBudget, fitBudgetForPlanning, buildPlanBudgetSummary, resolveActivityCost };
