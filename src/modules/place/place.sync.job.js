const cron = require("node-cron");
const placeRepository = require("./place.repository");
const locationRepository = require("../location/location.repository");

// Crawl địa điểm từ OpenTripMap — dữ liệu ít đổi nên 1 lần/tuần là đủ.
// Chạy 0h THỨ 3 (lệch 1 ngày với hotel sync 0h thứ 2) để 2 job nặng không
// chạy cùng lúc.
//
// Chiến lược tiết kiệm quota (free plan ~5000 req/ngày):
// - Mỗi thành phố chỉ 2 call radius (interesting_places + foods, limit 500).
// - Call chi tiết (/places/xid) tốn 1 request/điểm → CHỈ gọi cho điểm tham quan
//   rate >= 2 (điểm nổi tiếng, thường < 20 điểm/thành phố) để lấy mô tả + ảnh.
//   Quán ăn không gọi detail (hầu như không có dữ liệu wiki).
// → Tổng ~17 city × (2 + ~15) ≈ 300 request/lần sync, dư quota thoải mái.
const DETAIL_MIN_RATE = 2;
const DETAIL_DELAY_MS = 250; // giãn call detail, tránh chạm rate limit theo giây

// OpenTripMap trả rate dạng số hoặc chuỗi có hậu tố 'h' (di sản, vd "3h") —
// chuẩn hoá về số 0-7
const parseRate = (rate) => {
  const n = parseInt(String(rate ?? "0").replace("h", ""), 10);
  return Number.isNaN(n) ? 0 : Math.min(n, 7);
};

// Ước lượng thời gian tham quan theo loại điểm
const estimateVisitMinutes = (category, kinds) => {
  if (category === "food") return 60;
  if (/museums|theatres/.test(kinds)) return 120;
  if (/beaches|natural|amusements/.test(kinds)) return 150;
  return 90;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lọc + khử trùng lặp kết quả radius: bỏ điểm không tên, gộp điểm trùng tên
// (OSM hay có nhiều node cho cùng 1 địa danh — giữ bản rate cao nhất)
const dedupeByName = (items) => {
  const byName = new Map();
  for (const item of items) {
    const name = (item.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing || parseRate(item.rate) > parseRate(existing.rate)) {
      byName.set(key, item);
    }
  }
  return [...byName.values()];
};

const toRow = (item, location, category, detail = null) => ({
  xid: item.xid,
  location_id: location.id,
  name: (item.name || "").trim().slice(0, 255),
  category,
  kinds: (item.kinds || "").slice(0, 500),
  address: detail
    ? [detail.address?.road, detail.address?.suburb, detail.address?.city || detail.address?.town]
        .filter(Boolean).join(", ").slice(0, 500) || null
    : null,
  latitude: item.point?.lat ?? null,
  longitude: item.point?.lon ?? null,
  rate: parseRate(item.rate),
  description: detail?.wikipedia_extracts?.text?.slice(0, 5000) ?? null,
  image: detail?.preview?.source?.slice(0, 500) ?? null,
  wikipedia: detail?.wikipedia?.slice(0, 500) ?? null,
  visit_minutes: estimateVisitMinutes(category, item.kinds || ""),
});

// ─── syncCity ─────────────────────────────────────────────────────────────────
const syncCity = async (location) => {
  console.log(`[PlaceSync] Bắt đầu crawl: ${location.city_name} (${location.city_code})`);

  try {
    const base = {
      lat: Number(location.latitude),
      lon: Number(location.longitude),
      radius: location.crawl_radius_m || 10000,
    };

    const [attractions, foods] = [
      dedupeByName(await placeRepository.fetchRadius({ ...base, kinds: "interesting_places" })),
      dedupeByName(await placeRepository.fetchRadius({ ...base, kinds: "foods" })),
    ];

    // Điểm nổi tiếng: gọi detail để lấy mô tả/ảnh (tuần tự, có giãn cách)
    const rows = [];
    for (const item of attractions.filter((a) => a.xid)) {
      let detail = null;
      if (parseRate(item.rate) >= DETAIL_MIN_RATE) {
        try {
          detail = await placeRepository.fetchDetail(item.xid);
        } catch (err) {
          console.warn(`[PlaceSync] Lỗi detail ${item.xid}:`, err.message);
        }
        await sleep(DETAIL_DELAY_MS);
      }
      rows.push(toRow(item, location, "attraction", detail));
    }

    for (const item of foods.filter((f) => f.xid)) {
      rows.push(toRow(item, location, "food"));
    }

    const valid = rows.filter((r) => r.latitude != null && r.longitude != null && r.name);
    const count = await placeRepository.bulkUpsertPlaces(valid);

    console.log(
      `[PlaceSync] Hoàn thành ${location.city_name}: ${count} điểm ` +
      `(tham quan: ${attractions.length}, ăn uống: ${foods.length})`
    );
    return { city: location.city_code, success: true, count };
  } catch (error) {
    console.error(`[PlaceSync] Lỗi khi crawl ${location.city_name}:`, error.message);
    return { city: location.city_code, success: false, count: 0, error: error.message };
  }
};

// ─── syncAllCities ────────────────────────────────────────────────────────────
const syncAllCities = async () => {
  const locations = await locationRepository.getAllLocations();
  const withCoords = locations.filter((l) => l.latitude != null && l.longitude != null);
  console.log(`[PlaceSync] Bắt đầu crawl ${withCoords.length} thành phố lúc ${new Date().toISOString()}`);

  const results = [];
  for (const location of withCoords) {
    results.push(await syncCity(location));
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);
  console.log(`[PlaceSync] Kết quả: ${succeeded}/${withCoords.length} thành phố thành công`);
  if (failed.length > 0) {
    console.warn(`[PlaceSync] Thất bại:`, failed.map((r) => r.city).join(", "));
  }

  // Enrich tiếng Việt + ảnh, rồi lọc trùng lặp cho dữ liệu mới crawl
  // (best-effort — lỗi không làm fail sync).
  // require tại chỗ để tránh vòng lặp import nếu các job sau này cần sync job.
  try {
    await require("./place.enrich.job").enrichAllPlaces();
  } catch (err) {
    console.warn("[PlaceSync] Enrich lỗi (bỏ qua):", err.message);
  }
  try {
    await require("./place.dedupe.job").dedupeAllPlaces();
  } catch (err) {
    console.warn("[PlaceSync] Dedupe lỗi (bỏ qua):", err.message);
  }

  return results;
};

// ─── Cron: 0h thứ 3 hằng tuần ─────────────────────────────────────────────────
cron.schedule(
  "0 0 * * 2",
  async () => {
    console.log("[PlaceSync] Cron hàng tuần bắt đầu...");
    try {
      await syncAllCities();
    } catch (err) {
      console.error("[PlaceSync] Cron gặp lỗi nghiêm trọng:", err.message);
    }
  },
  { timezone: "Asia/Ho_Chi_Minh" }
);

console.log("[PlaceSync] Cron job đã được đăng ký — chạy 0h thứ 3 hằng tuần (Asia/Ho_Chi_Minh)");

module.exports = { syncAllCities, syncCity };
