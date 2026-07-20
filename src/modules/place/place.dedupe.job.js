const db = require("../../shared/config/database");

// Lọc địa điểm trùng lặp trong bảng places. Nguồn trùng: OSM có nhiều node cho
// cùng địa danh với biến thể tên (có dấu/không dấu, gạch nối, sai chính tả dấu),
// mỗi node mang xid riêng nên sync upsert thành nhiều row; enrich tiếng Việt còn
// làm lộ thêm trùng (2 tên EN khác nhau → cùng name_vi/bài wiki).
//
// Tiêu chí gộp nhóm (trong cùng thành phố):
//   1. Trùng link wikipedia → chắc chắn cùng địa danh, KHÔNG cần gần nhau
//      (địa danh lớn như cầu/núi có node ở 2 đầu cách nhau cả km).
//   2. Tên chuẩn hoá giống nhau (bỏ dấu, bỏ ký tự đặc biệt — so trên cả name lẫn
//      name_vi) VÀ cùng category VÀ đủ gần nhau. Bắt buộc kèm khoảng cách vì
//      quán chuỗi (Phở 24, Trung Nguyên...) có nhiều chi nhánh trùng tên là
//      địa điểm THẬT khác nhau: food <= 100m, attraction <= 500m (địa danh lớn).
//   KHÔNG dùng khoảng cách đứng một mình — 2 địa điểm khác nhau có thể sát nhau.
//
// Xử lý: giữ bản tốt nhất mỗi nhóm (rate cao nhất → có ảnh → có mô tả VI → id nhỏ),
// gộp dữ liệu còn thiếu từ các bản kia vào bản giữ, rồi SOFT-DELETE (is_active=0)
// bản thừa — không xoá row để không phá FK trip_activities và khôi phục được.
// Idempotent — chạy lại thoải mái.

const NAME_DISTANCE_M = { attraction: 500, food: 100 };

// "Phở-2000" / "Pho 2000" / "phở  2000" → "pho2000"
const normalizeName = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");

const distanceM = (a, b) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Union-Find gọn để gộp các cặp trùng thành nhóm
const makeUnionFind = (ids) => {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => parent.set(find(a), find(b));
  return { find, union };
};

const pickKeeper = (group) =>
  [...group].sort(
    (a, b) =>
      b.rate - a.rate ||
      (b.image ? 1 : 0) - (a.image ? 1 : 0) ||
      (b.description_vi ? 1 : 0) - (a.description_vi ? 1 : 0) ||
      a.id - b.id
  )[0];

const dedupeAllPlaces = async () => {
  const [places] = await db.execute(
    `SELECT id, location_id, category, name, name_vi, wikipedia,
            latitude, longitude, rate, image, description, description_vi
     FROM places WHERE is_active = 1`
  );
  console.log(`[PlaceDedupe] Kiểm tra ${places.length} địa điểm đang hiển thị`);

  for (const p of places) {
    p.latitude = Number(p.latitude);
    p.longitude = Number(p.longitude);
  }
  const uf = makeUnionFind(places.map((p) => p.id));

  // 1. Trùng wikipedia (cùng thành phố)
  const byWiki = new Map();
  for (const p of places) {
    if (!p.wikipedia) continue;
    const key = `${p.location_id}|${p.wikipedia.toLowerCase()}`;
    if (byWiki.has(key)) uf.union(p.id, byWiki.get(key));
    else byWiki.set(key, p.id);
  }

  // 2. Tên chuẩn hoá giống nhau + cùng category + đủ gần
  const byName = new Map();
  for (const p of places) {
    const keys = new Set([normalizeName(p.name), normalizeName(p.name_vi)]);
    for (const n of keys) {
      if (n.length < 3) continue; // tên quá ngắn ("DC"...) dễ gộp nhầm — bỏ qua
      const key = `${p.location_id}|${p.category}|${n}`;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(p);
    }
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const maxDist = NAME_DISTANCE_M[group[0].category] ?? 100;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (distanceM(group[i], group[j]) <= maxDist) uf.union(group[i].id, group[j].id);
      }
    }
  }

  // Gom nhóm theo root
  const groups = new Map();
  for (const p of places) {
    const root = uf.find(p.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }

  let deactivated = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = pickKeeper(group);
    const losers = group.filter((p) => p.id !== keeper.id);

    // Gộp dữ liệu bản thừa vào bản giữ trước khi tắt (chỉ điền chỗ trống)
    const donor = (field) => losers.find((l) => l[field])?.[field] ?? null;
    await db.execute(
      `UPDATE places SET
         name_vi        = COALESCE(name_vi, ?),
         description    = COALESCE(description, ?),
         description_vi = COALESCE(description_vi, ?),
         image          = COALESCE(image, ?),
         wikipedia      = COALESCE(wikipedia, ?)
       WHERE id = ?`,
      [donor("name_vi"), donor("description"), donor("description_vi"),
       donor("image"), donor("wikipedia"), keeper.id]
    );

    const loserIds = losers.map((l) => l.id);
    await db.execute(
      `UPDATE places SET is_active = 0 WHERE id IN (${loserIds.map(() => "?").join(",")})`,
      loserIds
    );
    deactivated += loserIds.length;
    console.log(
      `[PlaceDedupe] Giữ #${keeper.id} "${keeper.name_vi || keeper.name}" — tắt ${loserIds.length} bản trùng: ` +
      losers.map((l) => `#${l.id} "${l.name}"`).join(", ")
    );
  }

  console.log(`[PlaceDedupe] Hoàn thành — tắt ${deactivated} bản trùng`);
  return deactivated;
};

module.exports = { dedupeAllPlaces };
