const tripService = require("../trip/trip.service");
const hotelService = require("../hotel_liteapi/hotel.service");
const flightService = require("../flight/flight.service");
const db = require("../../shared/config/database");

const validationError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// Toàn bộ budget tính bằng VND. Khách sạn lấy giá VND trực tiếp từ LiteAPI;
// vé bay Ignav chỉ trả USD → quy đổi qua tỷ giá USD_VND_RATE (env, cập nhật
// tay khi tỷ giá biến động mạnh — đồ án không cần API tỷ giá real-time).
const MEAL_COST = Number(process.env.BUDGET_MEAL_COST_VND) || 100_000;            // 1 bữa/người
const UNKNOWN_ATTRACTION_FEE = Number(process.env.BUDGET_ATTRACTION_FEE_VND) || 50_000; // vé vào cửa ước tính khi không có dữ liệu
const LOCAL_TRANSPORT_PER_DAY = Number(process.env.BUDGET_TRANSPORT_VND_PER_DAY) || 250_000; // taxi/xe máy cả nhóm/ngày
const USD_VND_RATE = Number(process.env.USD_VND_RATE) || 26_500;

// VND không có số lẻ — làm tròn về nghìn đồng cho dễ đọc
const roundVnd = (n) => Math.round(n / 1000) * 1000;

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

// ─── Ăn uống + vé tham quan: từ lịch trình đã sinh (nếu có) ──────────────────
const estimateFromItinerary = async (trip, days) => {
  const [acts] = await db.execute(
    `SELECT ta.activity_type, p.avg_cost
     FROM trip_activities ta JOIN places p ON ta.place_id = p.id
     WHERE ta.trip_id = ?`,
    [trip.id]
  );

  if (acts.length === 0) {
    // Chưa sinh lịch trình → ước theo mặc định: 3 bữa/ngày, 3 điểm tham quan/ngày
    return {
      has_itinerary: false,
      meals: {
        count: days * 3 * trip.num_people,
        total: roundVnd(days * 3 * trip.num_people * MEAL_COST),
      },
      attractions: {
        count: days * 3,
        known_cost: 0,
        estimated_total: roundVnd(days * 3 * trip.num_people * UNKNOWN_ATTRACTION_FEE),
      },
    };
  }

  const meals = acts.filter((a) => a.activity_type === "meal");
  const visits = acts.filter((a) => a.activity_type === "visit");
  // Lịch trình chỉ xếp trưa+tối — cộng thêm bữa sáng mỗi ngày
  const mealCount = (meals.length + days) * trip.num_people;

  const knownCost = visits.reduce((s, v) => s + (v.avg_cost != null ? Number(v.avg_cost) : 0), 0);
  const unknownCount = visits.filter((v) => v.avg_cost == null).length;

  return {
    has_itinerary: true,
    meals: { count: mealCount, total: roundVnd(mealCount * MEAL_COST) },
    attractions: {
      count: visits.length,
      known_cost: roundVnd(knownCost * trip.num_people),
      estimated_total: roundVnd((knownCost + unknownCount * UNKNOWN_ATTRACTION_FEE) * trip.num_people),
    },
  };
};

// ─── fitBudgetForPlanning — dùng bởi itinerary khi sinh lịch trình ────────────
// Tính TRƯỚC KHI xếp lịch: từ ngân sách trừ đi chi phí cố định (ăn/vé/di chuyển
// theo pace), phần còn lại chọn khách sạn phù hợp. Nếu pace user muốn làm tổng
// vượt budget → tự hạ pace (packed→moderate→relaxed). Vẫn vượt → cảnh báo.
// Vé bay KHÔNG tính ở đây (trip không lưu điểm xuất phát) — có ghi chú trong summary.
const ATTRACTIONS_PER_DAY = { relaxed: 2, moderate: 3, packed: 4 };
const PACE_DOWNGRADE = { packed: "moderate", moderate: "relaxed", relaxed: null };
// Chọn khách sạn đắt nhất còn ≤ 85% ngân sách còn lại (chừa 15% dự phòng);
// nếu không có thì lấy phương án rẻ nhất vừa túi
const HOTEL_BUDGET_RATIO = 0.85;

const fixedCostsForPace = (pace, days, numPeople) => {
  const visits = days * (ATTRACTIONS_PER_DAY[pace] ?? 3);
  const mealCount = days * 3 * numPeople; // sáng + trưa + tối
  return {
    visits,
    meals: { count: mealCount, total: roundVnd(mealCount * MEAL_COST) },
    attractions: { count: visits, total: roundVnd(visits * numPeople * UNKNOWN_ATTRACTION_FEE) },
    transport: roundVnd(days * LOCAL_TRANSPORT_PER_DAY),
  };
};

const pickHotel = (options, remaining) => {
  const affordable = options.filter((o) => o.price <= remaining);
  if (affordable.length === 0) return null;
  const comfy = affordable.filter((o) => o.price <= remaining * HOTEL_BUDGET_RATIO);
  return (comfy.length > 0 ? comfy : affordable).at(-1); // options đã sort tăng dần
};

const fitBudgetForPlanning = async (trip, wishedPace = "moderate") => {
  const nights = Math.round((new Date(trip.end_date) - new Date(trip.start_date)) / 86_400_000);
  const days = nights + 1;
  const budgetTotal = trip.budget_total != null ? Number(trip.budget_total) : null;
  const warnings = [];

  const { options, rooms } = await getHotelOptionsForTrip(trip);
  const prices = options.map((o) => o.price);

  // Không có ngân sách → giữ nguyên pace, gợi ý khách sạn mức trung vị
  if (budgetTotal == null) {
    const costs = fixedCostsForPace(wishedPace, days, trip.num_people);
    const selected = options.length > 0
      ? options[Math.floor(options.length / 2)]
      : null;
    return { effectivePace: wishedPace, wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings };
  }

  // Thử pace user muốn, hạ dần nếu tổng vượt budget
  let pace = wishedPace;
  while (pace) {
    const costs = fixedCostsForPace(pace, days, trip.num_people);
    const fixed = costs.meals.total + costs.attractions.total + costs.transport;
    const remaining = budgetTotal - fixed;
    const selected = pickHotel(options, remaining);

    if (selected || options.length === 0) {
      if (pace !== wishedPace) {
        warnings.push(`Đã giảm nhịp độ từ "${wishedPace}" xuống "${pace}" để phù hợp ngân sách`);
      }
      if (options.length === 0) {
        warnings.push("Không lấy được giá khách sạn — chi phí khách sạn chưa gồm trong tổng");
      }
      return { effectivePace: pace, wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings };
    }
    pace = PACE_DOWNGRADE[pace];
  }

  // Đến relaxed + khách sạn rẻ nhất vẫn vượt budget → trả phương án tối thiểu kèm cảnh báo
  const costs = fixedCostsForPace("relaxed", days, trip.num_people);
  const selected = options[0] ?? null;
  const minTotal = costs.meals.total + costs.attractions.total + costs.transport + (selected?.price ?? 0);
  warnings.push(
    `Ngân sách ${roundVnd(budgetTotal).toLocaleString("vi-VN")}đ quá thấp — phương án tiết kiệm nhất cũng cần ~${roundVnd(minTotal).toLocaleString("vi-VN")}đ`
  );
  if (wishedPace !== "relaxed") {
    warnings.push(`Đã giảm nhịp độ từ "${wishedPace}" xuống "relaxed" để tiết kiệm tối đa`);
  }
  return { effectivePace: "relaxed", wishedPace, days, rooms, costs, selected, options, prices, budgetTotal, warnings };
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
    hotelCost + fit.costs.meals.total + fit.costs.attractions.total + fit.costs.transport
  );

  return {
    currency: "VND",
    requested_pace: fit.wishedPace,
    effective_pace: fit.effectivePace,
    hotel: hotelInfo,
    meals: fit.costs.meals,
    attractions: fit.costs.attractions,
    local_transport: { total: fit.costs.transport },
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

  const transport = roundVnd(days * LOCAL_TRANSPORT_PER_DAY);

  // Tổng ưu tiên khách sạn đã chọn khi plan (đồng nhất với budget_summary);
  // chưa plan thì theo mức trung vị; không có giá nào thì bỏ qua thành phần đó
  const hotelCost = hotel ? (hotel.selected?.price ?? hotel.standard ?? 0) : 0;
  const flightCost = flight?.available ? flight.total : 0;
  const total = roundVnd(
    hotelCost + flightCost + activityCosts.meals.total +
    activityCosts.attractions.estimated_total + transport
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
      local_transport: { per_day: LOCAL_TRANSPORT_PER_DAY, total: transport },
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

module.exports = { estimateBudget, fitBudgetForPlanning, buildPlanBudgetSummary };
