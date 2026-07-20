const { client, withRetry } = require("./liteapi.client");
const { getOrSet } = require("../../shared/utils/cache");
const db = require("../../shared/config/database");
const locationRepository = require("../location/location.repository");

const SEARCH_TTL_MS = 5 * 60 * 1000;   // 5 phút — danh sách/giá đổi khá thường xuyên
const DETAIL_TTL_MS = 60 * 60 * 1000;  // 1 giờ — thông tin tĩnh khách sạn ít khi đổi

// ─── DB row -> shape giống response LiteAPI (để service/slimForList dùng chung) ──
const rowToApiShape = (row) => ({
  id: row.hotel_id,
  name: row.name,
  address: row.address,
  country: row.country_code,
  city: row.city_name,
  latitude: row.latitude != null ? Number(row.latitude) : null,
  longitude: row.longitude != null ? Number(row.longitude) : null,
  stars: row.star_rating != null ? Number(row.star_rating) : null,
  rating: row.review_score != null ? Number(row.review_score) : null,
  reviewCount: row.review_count,
  currency: row.currency,
  chain: row.chain,
  main_photo: row.main_photo,
  thumbnail: row.thumbnail,
  // mysql2 tự parse cột JSON thành object/array sẵn — chỉ JSON.parse nếu vẫn là chuỗi
  facilityIds: Array.isArray(row.facility_ids)
    ? row.facility_ids
    : row.facility_ids
      ? JSON.parse(row.facility_ids)
      : [],
});

// ─── findByCity ───────────────────────────────────────────────────────────────
// Ưu tiên đọc từ DB (đã crawl sẵn hàng tuần, xem hotel.sync.job.js) — nhanh,
// không tốn quota LiteAPI. Nếu thành phố chưa được crawl (chưa có trong bảng
// locations, hoặc chưa có hotel nào), fallback về gọi live + cache 5 phút như
// trước để không bị gãy tính năng.
const findByCity = async ({ countryCode, cityName, limit, offset }) => {
  const location = await locationRepository.findByCityName(countryCode, cityName);

  if (location) {
    // mysql2 không nhận LIMIT/OFFSET qua placeholder `?` trong execute() (prepared
    // statement) một cách ổn định — ép kiểu số nguyên rồi nội suy trực tiếp là an
    // toàn vì đã qua Number()/parseInt, không phải chuỗi thô từ client.
    const safeLimit = Math.max(parseInt(limit, 10) || 20, 1);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

    const [rows] = await db.execute(
      `SELECT * FROM hotels WHERE location_id = ?
       ORDER BY star_rating DESC, review_score DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [location.id]
    );
    if (rows.length > 0) return rows.map(rowToApiShape);
  }

  const key = `hotels:city:${countryCode}:${cityName}:${limit}:${offset}`;
  return getOrSet(key, SEARCH_TTL_MS, async () => {
    const { data } = await withRetry(() =>
      client.get("/data/hotels", { params: { countryCode, cityName, limit, offset } })
    );
    return data.data ?? [];
  });
};

// ─── fetchCityHotelsFromApi ───────────────────────────────────────────────────
// Gọi LiteAPI trực tiếp, KHÔNG qua cache — chỉ dùng bởi hotel.sync.job.js để
// lấy dữ liệu mới nhất crawl vào DB (không có ý nghĩa cache khi chỉ chạy 1 lần/tuần).
const fetchCityHotelsFromApi = async (countryCode, cityName, limit) => {
  const { data } = await withRetry(() =>
    client.get("/data/hotels", { params: { countryCode, cityName, limit, offset: 0 } })
  );
  return data.data ?? [];
};

// ─── bulkUpsertHotels ─────────────────────────────────────────────────────────
// Bulk INSERT ... ON DUPLICATE KEY UPDATE — dùng bởi hotel.sync.job.js.
// Tự chia chunk để tránh MySQL "too many placeholders".
const BULK_CHUNK = 500; // 16 params/row

const bulkUpsertHotels = async (hotels) => {
  if (!hotels || hotels.length === 0) return 0;

  for (let i = 0; i < hotels.length; i += BULK_CHUNK) {
    const chunk = hotels.slice(i, i + BULK_CHUNK);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())")
      .join(", ");
    const values = chunk.flatMap((h) => [
      h.hotel_id, h.location_id, h.name, h.address, h.country_code, h.city_name,
      h.latitude, h.longitude, h.star_rating, h.review_score, h.review_count,
      h.currency, h.chain, h.main_photo, h.thumbnail,
      JSON.stringify(h.facility_ids ?? []),
    ]);

    await db.execute(
      `INSERT INTO hotels (
         hotel_id, location_id, name, address, country_code, city_name,
         latitude, longitude, star_rating, review_score, review_count,
         currency, chain, main_photo, thumbnail, facility_ids, last_synced_at
       )
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         location_id    = VALUES(location_id),
         name           = VALUES(name),
         address        = VALUES(address),
         country_code   = VALUES(country_code),
         city_name      = VALUES(city_name),
         latitude       = VALUES(latitude),
         longitude      = VALUES(longitude),
         star_rating    = VALUES(star_rating),
         review_score   = VALUES(review_score),
         review_count   = VALUES(review_count),
         currency       = VALUES(currency),
         chain          = VALUES(chain),
         main_photo     = VALUES(main_photo),
         thumbnail      = VALUES(thumbnail),
         facility_ids   = VALUES(facility_ids),
         last_synced_at = NOW()`,
      values
    );
  }

  return hotels.length;
};

const findByIds = async (hotelIds) => {
  const key = `hotels:ids:${[...hotelIds].sort().join(",")}`;
  return getOrSet(key, SEARCH_TTL_MS, async () => {
    const { data } = await withRetry(() =>
      client.get("/data/hotels", {
        params: { hotelIds: hotelIds.join(","), limit: hotelIds.length },
      })
    );
    return data.data ?? [];
  });
};

const findById = async (hotelId) => {
  const key = `hotel:detail:${hotelId}`;
  return getOrSet(key, DETAIL_TTL_MS, async () => {
    const { data } = await withRetry(() => client.get("/data/hotel", { params: { hotelId } }));
    return data.data ?? null;
  });
};

const getRates = async (payload) => {
  const key = `rates:${JSON.stringify(payload)}`;
  return getOrSet(key, SEARCH_TTL_MS, async () => {
    const { data } = await withRetry(() => client.post("/hotels/rates", payload));
    return data.data ?? [];
  });
};

module.exports = {
  findByCity,
  findByIds,
  findById,
  getRates,
  fetchCityHotelsFromApi,
  bulkUpsertHotels,
};
