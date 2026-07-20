const cron = require("node-cron");
const hotelRepository = require("./hotel.repository");
const locationRepository = require("../location/location.repository");

// Dữ liệu tĩnh (tên, địa chỉ, ảnh,...) ít đổi nên chỉ crawl 1 lần/tuần là đủ mới.
// Giá phòng KHÔNG crawl ở đây — vẫn gọi live LiteAPI (xem hotel.repository.js#getRates)
// vì giá phụ thuộc ngày/số khách và đổi liên tục, crawl trước dễ hiển thị sai giá.
const MAX_HOTELS_PER_CITY = Number(process.env.HOTEL_SYNC_MAX_PER_CITY) || 1000;

const mapHotelToRow = (h, location) => ({
  hotel_id: h.id,
  location_id: location.id,
  name: h.name || null,
  address: h.address || null,
  country_code: (h.country || location.country_code || "").toUpperCase() || null,
  city_name: h.city || location.city_name || null,
  latitude: h.latitude ?? null,
  longitude: h.longitude ?? null,
  star_rating: h.stars ?? null,
  review_score: h.rating ?? null,
  review_count: h.reviewCount ?? null,
  currency: h.currency || null,
  chain: h.chain || null,
  main_photo: h.main_photo || null,
  thumbnail: h.thumbnail || null,
  facility_ids: h.facilityIds ?? [],
});

// ─── syncCity ──────────────────────────────────────────────────────────────────
const syncCity = async (location) => {
  console.log(`[HotelSync] Bắt đầu crawl: ${location.city_name} (${location.city_code})`);

  try {
    const hotels = await hotelRepository.fetchCityHotelsFromApi(
      location.country_code,
      location.city_name,
      MAX_HOTELS_PER_CITY
    );

    if (!hotels || hotels.length === 0) {
      console.warn(`[HotelSync] Không có dữ liệu cho: ${location.city_name}`);
      return { city: location.city_code, success: false, count: 0 };
    }

    const rows = hotels
      .filter((h) => h.id) // bỏ record thiếu id (không thể upsert vì hotel_id là khoá)
      .map((h) => mapHotelToRow(h, location));

    const count = await hotelRepository.bulkUpsertHotels(rows);
    console.log(`[HotelSync] Hoàn thành ${location.city_name}: ${count} khách sạn`);
    return { city: location.city_code, success: true, count };
  } catch (error) {
    console.error(`[HotelSync] Lỗi khi crawl ${location.city_name}:`, error.message);
    return { city: location.city_code, success: false, count: 0, error: error.message };
  }
};

// ─── syncAllCities ────────────────────────────────────────────────────────────
// Crawl từng thành phố TUẦN TỰ (không song song) để tránh bắn nhiều request
// đồng thời vào LiteAPI.
const syncAllCities = async () => {
  const locations = await locationRepository.getAllLocations();
  console.log(`[HotelSync] Bắt đầu crawl ${locations.length} thành phố lúc ${new Date().toISOString()}`);

  const results = [];
  for (const location of locations) {
    results.push(await syncCity(location));
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);
  console.log(`[HotelSync] Kết quả: ${succeeded}/${locations.length} thành phố thành công`);
  if (failed.length > 0) {
    console.warn(`[HotelSync] Thất bại:`, failed.map((r) => r.city).join(", "));
  }

  return results;
};

// ─── Cron: 0h thứ 2 hằng tuần ─────────────────────────────────────────────────
cron.schedule(
  "0 0 * * 1",
  async () => {
    console.log("[HotelSync] Cron hàng tuần bắt đầu...");
    try {
      await syncAllCities();
    } catch (err) {
      console.error("[HotelSync] Cron gặp lỗi nghiêm trọng:", err.message);
    }
  },
  { timezone: "Asia/Ho_Chi_Minh" }
);

console.log("[HotelSync] Cron job đã được đăng ký — chạy 0h thứ 2 hằng tuần (Asia/Ho_Chi_Minh)");

module.exports = { syncAllCities, syncCity };
