const db = require("../../shared/config/database");
const { client, withRetry } = require("./opentripmap.client");

// ─── Gọi OpenTripMap (chỉ dùng bởi place.sync.job.js) ────────────────────────
// Tìm địa điểm quanh toạ độ theo kinds; limit tối đa 500/call (giới hạn OTM)
const fetchRadius = async ({ lat, lon, radius, kinds, limit = 500 }) => {
  const { data } = await withRetry(() =>
    client.get("/places/radius", {
      params: { lat, lon, radius, kinds, limit, format: "json" },
    })
  );
  return data ?? [];
};

// Chi tiết 1 điểm theo xid — có mô tả Wikipedia + ảnh + địa chỉ.
// Mỗi call = 1 request quota nên sync job chỉ gọi cho điểm rate >= 2.
const fetchDetail = async (xid) => {
  const { data } = await withRetry(() => client.get(`/places/xid/${encodeURIComponent(xid)}`));
  return data ?? null;
};

// ─── DB ───────────────────────────────────────────────────────────────────────
const BULK_CHUNK = 300; // 13 params/row

const bulkUpsertPlaces = async (places) => {
  if (!places || places.length === 0) return 0;

  for (let i = 0; i < places.length; i += BULK_CHUNK) {
    const chunk = places.slice(i, i + BULK_CHUNK);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())")
      .join(", ");
    const values = chunk.flatMap((p) => [
      p.xid, p.location_id, p.name, p.category, p.kinds, p.address,
      p.latitude, p.longitude, p.rate, p.description, p.image, p.wikipedia,
      p.visit_minutes,
    ]);

    await db.execute(
      `INSERT INTO places (
         xid, location_id, name, category, kinds, address,
         latitude, longitude, rate, description, image, wikipedia,
         visit_minutes, last_synced_at
       )
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         location_id    = VALUES(location_id),
         name           = VALUES(name),
         category       = VALUES(category),
         kinds          = VALUES(kinds),
         address        = COALESCE(VALUES(address), address),
         latitude       = VALUES(latitude),
         longitude      = VALUES(longitude),
         rate           = VALUES(rate),
         description    = COALESCE(VALUES(description), description),
         image          = COALESCE(VALUES(image), image),
         wikipedia      = COALESCE(VALUES(wikipedia), wikipedia),
         visit_minutes  = VALUES(visit_minutes),
         last_synced_at = NOW()`,
      values
    );
  }

  return places.length;
};

// ─── Enrich tiếng Việt + ảnh (dùng bởi place.enrich.job.js) ──────────────────
// Điểm có link Wikipedia mà chưa có bản dịch hoặc chưa có ảnh → thử Wikipedia trước
const findNeedingWikiEnrich = async (limit = 500) => {
  const safeLimit = Math.max(parseInt(limit, 10) || 500, 1);
  const [rows] = await db.execute(
    `SELECT id, name, wikipedia, description, description_vi, name_vi, image
     FROM places
     WHERE wikipedia IS NOT NULL AND is_active = 1
       AND (description_vi IS NULL OR name_vi IS NULL OR image IS NULL)
     ORDER BY rate DESC
     LIMIT ${safeLimit}`
  );
  return rows;
};

// Điểm nổi tiếng còn thiếu bản dịch sau bước Wikipedia → Gemini dịch batch.
// Chỉ giới hạn attraction rate >= 2: tên các điểm này từ wiki tiếng Anh;
// điểm thường và quán ăn mang tên OSM bản địa (đa số đã là tiếng Việt).
const findNeedingTranslation = async (limit = 300) => {
  const safeLimit = Math.max(parseInt(limit, 10) || 300, 1);
  const [rows] = await db.execute(
    `SELECT id, name, description
     FROM places
     WHERE category = 'attraction' AND rate >= 2 AND is_active = 1
       AND (name_vi IS NULL OR (description IS NOT NULL AND description_vi IS NULL))
     ORDER BY rate DESC
     LIMIT ${safeLimit}`
  );
  return rows;
};

// COALESCE để không ghi đè dữ liệu đã có bằng NULL (enrich là bổ sung, không thay thế)
const updateEnrichment = async (id, { nameVi, descriptionVi, image }) => {
  await db.execute(
    `UPDATE places SET
       name_vi        = COALESCE(?, name_vi),
       description_vi = COALESCE(?, description_vi),
       image          = COALESCE(?, image)
     WHERE id = ?`,
    [nameVi ?? null, descriptionVi ?? null, image ?? null, id]
  );
};

// Tất cả điểm đang có ảnh dạng thumbnail Wikimedia "NNpx-..." — dùng để rà soát/sửa
// lại width không chuẩn (xem normalizeWikimediaThumbWidth trong place.enrich.job.js).
// Không lọc is_active vì ảnh cũ có thể còn ở bản ghi đã bị dedupe soft-delete.
const findImagesNeedingWidthCheck = async () => {
  const [rows] = await db.execute(
    `SELECT id, image FROM places WHERE image LIKE '%px-%'`
  );
  return rows;
};

// Ghi đè trực tiếp (không COALESCE) — dùng để sửa lại URL ảnh đã lưu sai, khác với
// updateEnrichment vốn chỉ bổ sung dữ liệu còn thiếu
const setImage = async (id, image) => {
  await db.execute(`UPDATE places SET image = ? WHERE id = ?`, [image, id]);
};

// Dùng chung bởi findByLocation + countByLocation để 2 query luôn khớp điều kiện lọc
const buildLocationConditions = ({ locationId, category, minRate }) => {
  const conditions = ["location_id = ?", "is_active = 1"];
  const params = [locationId];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (minRate != null) {
    conditions.push("rate >= ?");
    params.push(minRate);
  }

  return { where: conditions.join(" AND "), params };
};

const findByLocation = async ({ locationId, category, minRate, limit, offset }) => {
  const safeLimit = Math.max(parseInt(limit, 10) || 50, 1);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  const { where, params } = buildLocationConditions({ locationId, category, minRate });

  const [rows] = await db.execute(
    `SELECT * FROM places WHERE ${where}
     ORDER BY rate DESC, name ASC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params
  );
  return rows;
};

// Tổng số bản ghi khớp điều kiện lọc (không bị giới hạn bởi limit/offset) — cho FE tính số trang
const countByLocation = async ({ locationId, category, minRate }) => {
  const { where, params } = buildLocationConditions({ locationId, category, minRate });
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM places WHERE ${where}`, params);
  return total;
};

module.exports = {
  fetchRadius, fetchDetail, bulkUpsertPlaces, findByLocation, countByLocation,
  findNeedingWikiEnrich, findNeedingTranslation, updateEnrichment,
  findImagesNeedingWidthCheck, setImage,
};
