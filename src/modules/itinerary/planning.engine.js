// ─────────────────────────────────────────────────────────────────────────────
// Travel Planning Engine — thuật toán thuần (không đụng DB/HTTP) theo pipeline
// trong tài liệu thiết kế:
//   Data Aggregation → Filtering & Scoring → Geo-clustering →
//   Route Optimization → Itinerary Generation
// Bước AI Personalization (OpenAI) thuộc giai đoạn 3, chưa có ở đây.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Khoảng cách haversine (km) ───────────────────────────────────────────────
const distanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── Dedupe ───────────────────────────────────────────────────────────────────
// OSM hay có nhiều bản ghi cho cùng 1 địa danh với tên khác nhau (vd Hoàng thành
// Thăng Long xuất hiện 3 lần). Gộp khi: cùng link wikipedia, HOẶC cùng category
// và cách nhau < 250m. Giữ bản có rate cao nhất (nhiều thông tin nhất).
const dedupePlaces = (places) => {
  const sorted = [...places].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const kept = [];

  for (const p of sorted) {
    const isDup = kept.some((k) => {
      if (p.wikipedia && k.wikipedia && p.wikipedia === k.wikipedia) return true;
      return (
        p.category === k.category &&
        distanceKm(Number(p.latitude), Number(p.longitude), Number(k.latitude), Number(k.longitude)) < 0.25
      );
    });
    if (!isDup) kept.push(p);
  }
  return kept;
};

// ─── Scoring ──────────────────────────────────────────────────────────────────
// score = w_price*priceScore + w_rating*ratingScore + w_distance*distScore
//         + w_preference*prefScore   (mỗi thành phần chuẩn hoá về 0-1)
const INTEREST_KINDS = {
  food:      ["foods", "restaurants", "cafes"],
  beach:     ["beaches"],
  culture:   ["cultural", "historic", "religion", "museums", "architecture", "theatres"],
  nature:    ["natural", "gardens_and_parks", "national_parks", "geological_formations"],
  nightlife: ["bars", "nightclubs", "pubs", "casinos"],
  shopping:  ["malls", "marketplaces", "shops"],
};

// Mốc "đắt" để chuẩn hoá priceScore — avg_cost lưu VND (vé tham quan/giá 1 suất
// ăn), 300k coi như cao cấp cho du lịch nội địa VN. Trước đây chia /50 theo mốc
// USD trong khi avg_cost thực chất là VND — bug tiềm ẩn (priceScore luôn ~0 một
// khi avg_cost được điền), chưa lộ ra vì avg_cost trước giờ luôn NULL.
const PRICE_NORMALIZE_VND = 300_000;

const scorePlace = (place, { center, radiusKm, interests, weights, maxRate = 7 }) => {
  // priceScore: avg_cost NULL (chưa enrich) thì trung tính 0.5; có giá thì càng
  // rẻ điểm càng cao, chuẩn hoá theo PRICE_NORMALIZE_VND
  const priceScore =
    place.avg_cost == null ? 0.5 : 1 - Math.min(Number(place.avg_cost) / PRICE_NORMALIZE_VND, 1);

  // ratingScore: chuẩn hoá theo rate CAO NHẤT của thành phố thay vì thang
  // cứng /7 — nhiều thành phố VN max rate chỉ 3, chia /7 làm chênh lệch giữa
  // điểm nổi tiếng (3) và điểm vô danh (1) quá nhỏ (~0.07), bị distScore nuốt
  // mất → lịch trình toàn chùa nhỏ gần trung tâm thay vì địa danh nổi tiếng.
  const ratingScore = Math.min((place.rate ?? 0) / Math.max(maxRate, 1), 1);

  // distScore: càng gần trung tâm càng cao
  const dist = distanceKm(center.lat, center.lon, Number(place.latitude), Number(place.longitude));
  const distScore = 1 - Math.min(dist / radiusKm, 1);

  // prefScore: tỉ lệ interests của user khớp với kinds của điểm
  let prefScore = 0.5; // user chưa khai báo sở thích → trung tính
  if (interests && interests.length > 0) {
    const kinds = place.kinds || "";
    const matched = interests.filter((i) =>
      (INTEREST_KINDS[i] || []).some((k) => kinds.includes(k))
    );
    prefScore = matched.length / interests.length;
  }

  return (
    Number(weights.w_price) * priceScore +
    Number(weights.w_rating) * ratingScore +
    Number(weights.w_distance) * distScore +
    Number(weights.w_preference) * prefScore
  );
};

// ─── Geo-clustering: k-means theo lat/lng, k = số ngày ───────────────────────
// Khởi tạo centroid bằng cách rải đều theo kinh độ (ổn định, không random —
// cùng input luôn ra cùng lịch trình, dễ test/demo).
const kmeansCluster = (points, k, iterations = 30) => {
  if (points.length <= k) {
    return points.map((p, i) => ({ ...p, cluster: i }));
  }

  const sorted = [...points].sort((a, b) => Number(a.longitude) - Number(b.longitude));
  let centroids = Array.from({ length: k }, (_, i) => {
    const p = sorted[Math.floor((i * (sorted.length - 1)) / Math.max(k - 1, 1))];
    return { lat: Number(p.latitude), lon: Number(p.longitude) };
  });

  let assigned = points.map((p) => ({ ...p, cluster: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (const p of assigned) {
      let best = 0;
      let bestDist = Infinity;
      centroids.forEach((c, i) => {
        const d = distanceKm(c.lat, c.lon, Number(p.latitude), Number(p.longitude));
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (p.cluster !== best) { p.cluster = best; changed = true; }
    }

    centroids = centroids.map((c, i) => {
      const members = assigned.filter((p) => p.cluster === i);
      if (members.length === 0) return c;
      return {
        lat: members.reduce((s, p) => s + Number(p.latitude), 0) / members.length,
        lon: members.reduce((s, p) => s + Number(p.longitude), 0) / members.length,
      };
    });

    if (!changed) break;
  }

  return assigned;
};

// Cân bằng số điểm giữa các ngày: ngày nào quá đầy thì đẩy điểm score thấp
// nhất sang ngày ít nhất (lịch 1 ngày 6 điểm + 1 ngày 0 điểm là vô dụng)
const balanceClusters = (points, k, maxPerCluster) => {
  const byCluster = Array.from({ length: k }, () => []);
  for (const p of points) byCluster[p.cluster].push(p);

  for (const group of byCluster) group.sort((a, b) => b.score - a.score);

  let moved = true;
  while (moved) {
    moved = false;
    const sizes = byCluster.map((g) => g.length);
    const maxIdx = sizes.indexOf(Math.max(...sizes));
    const minIdx = sizes.indexOf(Math.min(...sizes));
    if (sizes[maxIdx] > maxPerCluster && sizes[maxIdx] - sizes[minIdx] > 1) {
      const movedPoint = byCluster[maxIdx].pop();
      movedPoint.cluster = minIdx;
      byCluster[minIdx].push(movedPoint);
      moved = true;
    }
  }

  return byCluster;
};

// ─── Route Optimization: nearest-neighbor trong từng ngày ────────────────────
// Bắt đầu từ điểm gần trung tâm thành phố nhất, mỗi bước đi tới điểm chưa
// thăm gần nhất — không tối ưu tuyệt đối (TSP) nhưng đủ tốt và dễ giải thích.
const orderByNearestNeighbor = (points, center) => {
  if (points.length <= 1) return points;

  const remaining = [...points];
  remaining.sort(
    (a, b) =>
      distanceKm(center.lat, center.lon, Number(a.latitude), Number(a.longitude)) -
      distanceKm(center.lat, center.lon, Number(b.latitude), Number(b.longitude))
  );

  const route = [remaining.shift()];
  while (remaining.length > 0) {
    const last = route[route.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = distanceKm(
        Number(last.latitude), Number(last.longitude),
        Number(p.latitude), Number(p.longitude)
      );
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    route.push(remaining.splice(bestIdx, 1)[0]);
  }
  return route;
};

// ─── Xếp giờ + chèn bữa ăn ────────────────────────────────────────────────────
// Ngày bắt đầu 08:30; mỗi điểm = visit_minutes + 30' di chuyển.
// Ăn trưa (60') chèn khi timeline chạm 11:30; ăn tối cố định 18:30.
const DAY_START_MIN = 8 * 60 + 30;
const LUNCH_AFTER_MIN = 11 * 60 + 30;
const DINNER_MIN = 18 * 60 + 30;
const TRAVEL_BUFFER_MIN = 30;
const MEAL_MINUTES = 60;

const toTimeStr = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
};

// Chọn quán ăn gần centroid của ngày, ưu tiên rate cao, không dùng lại quán
const pickMeal = (foods, centroid, usedIds) => {
  const candidates = foods
    .filter((f) => !usedIds.has(f.id))
    .map((f) => ({
      ...f,
      _dist: distanceKm(centroid.lat, centroid.lon, Number(f.latitude), Number(f.longitude)),
    }))
    .filter((f) => f._dist <= 5)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || a._dist - b._dist);
  return candidates[0] ?? null;
};

const scheduleDay = (dayIndex, attractions, foods, usedFoodIds) => {
  const activities = [];
  let time = DAY_START_MIN;
  let lunchAdded = false;
  let order = 1;

  const centroid = attractions.length > 0
    ? {
        lat: attractions.reduce((s, p) => s + Number(p.latitude), 0) / attractions.length,
        lon: attractions.reduce((s, p) => s + Number(p.longitude), 0) / attractions.length,
      }
    : null;

  for (const place of attractions) {
    if (!lunchAdded && time >= LUNCH_AFTER_MIN) {
      const lunch = centroid ? pickMeal(foods, centroid, usedFoodIds) : null;
      if (lunch) {
        usedFoodIds.add(lunch.id);
        activities.push({ place: lunch, day_index: dayIndex, order_index: order++, start_time: toTimeStr(time), activity_type: "meal", score: null });
        time += MEAL_MINUTES + TRAVEL_BUFFER_MIN;
      }
      lunchAdded = true;
    }

    activities.push({ place, day_index: dayIndex, order_index: order++, start_time: toTimeStr(time), activity_type: "visit", score: place.score });
    time += (place.visit_minutes ?? 90) + TRAVEL_BUFFER_MIN;
  }

  // Ăn tối
  const dinnerTime = Math.max(time, DINNER_MIN);
  const dinner = centroid ? pickMeal(foods, centroid, usedFoodIds) : null;
  if (dinner) {
    usedFoodIds.add(dinner.id);
    activities.push({ place: dinner, day_index: dayIndex, order_index: order++, start_time: toTimeStr(dinnerTime), activity_type: "meal", score: null });
  }

  return activities;
};

// ─── Pipeline chính ───────────────────────────────────────────────────────────
const ATTRACTIONS_PER_DAY = { relaxed: 2, moderate: 3, packed: 4 };

const generateItinerary = ({ attractions, foods, days, center, radiusKm, preferences }) => {
  const weights = {
    w_price: preferences.w_price ?? 0.35,
    w_rating: preferences.w_rating ?? 0.25,
    w_distance: preferences.w_distance ?? 0.25,
    w_preference: preferences.w_preference ?? 0.15,
  };
  let interests = preferences.interests ?? [];
  if (typeof interests === "string") {
    try { interests = JSON.parse(interests); } catch { interests = []; }
  }
  const pace = preferences.pace ?? "moderate";
  const perDay = ATTRACTIONS_PER_DAY[pace] ?? 3;

  // 1. Dedupe + Scoring
  const deduped = dedupePlaces(attractions);
  const maxRate = Math.max(...deduped.map((p) => p.rate ?? 0), 1);
  const scored = deduped
    .map((p) => ({ ...p, score: scorePlace(p, { center, radiusKm, interests, weights, maxRate }) }))
    .sort((a, b) => b.score - a.score);

  // 2. Chọn top N = days × perDay
  const selected = scored.slice(0, days * perDay);
  if (selected.length === 0) return [];

  // 3. Geo-clustering theo ngày + cân bằng số điểm
  const effectiveDays = Math.min(days, selected.length);
  const clustered = kmeansCluster(selected, effectiveDays);
  const byDay = balanceClusters(clustered, effectiveDays, perDay);

  // 4. Route + xếp giờ từng ngày
  const dedupedFoods = dedupePlaces(foods);
  const usedFoodIds = new Set();
  const allActivities = [];

  byDay.forEach((dayPoints, i) => {
    const route = orderByNearestNeighbor(dayPoints, center);
    allActivities.push(...scheduleDay(i + 1, route, dedupedFoods, usedFoodIds));
  });

  return allActivities;
};

module.exports = { generateItinerary, dedupePlaces, scorePlace, distanceKm };
