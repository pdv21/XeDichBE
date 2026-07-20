const axios = require("axios");
const placeRepository = require("./place.repository");
const { generateJSON } = require("../../shared/config/llm.client");

// Enrich tiếng Việt + ảnh cho places sau khi sync từ OpenTripMap (dữ liệu gốc
// là mô tả wiki TIẾNG ANH, và nhiều điểm thiếu ảnh). Chạy 2 bước theo thứ tự
// ưu tiên chất lượng:
//   1. Wikipedia tiếng Việt (miễn phí, không cần key): điểm có link wiki EN →
//      langlinks tìm bài viWiki → lấy tên bài (= tên tiếng Việt chuẩn),
//      extract (mô tả người viết) và thumbnail (ảnh Wikimedia). Không có bài
//      viWiki thì vẫn tận dụng thumbnail bài EN để bù ảnh thiếu.
//   2. Gemini dịch batch (free tier, key sẵn có): phần attraction nổi tiếng
//      còn thiếu sau bước 1. Quán ăn/điểm thường mang tên OSM bản địa (đa số
//      đã là tiếng Việt) nên không dịch — tránh dịch hỏng tên riêng.
// Cả 2 bước đều idempotent (chỉ xử lý bản ghi còn thiếu) — chạy lại thoải mái.

const WIKI_DELAY_MS = 600; // giãn call Wikipedia — API công cộng hay 429 nếu gọi dồn dập
const GEMINI_BATCH_SIZE = 6; // desc dài ~1000 ký tự/điểm — batch nhỏ để không vượt maxOutputTokens
const GEMINI_DELAY_MS = 20_000; // free tier giới hạn theo phút khá gắt — chậm mà chắc
const GEMINI_429_WAIT_MS = 45_000; // dính 429 thì nghỉ dài rồi thử lại (tối đa 3 lần/batch)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wikiHttp = axios.create({
  timeout: 15_000,
  // Wikimedia yêu cầu User-Agent định danh (kèm contact) cho API client
  headers: { "User-Agent": "XeDichBot/1.0 (https://github.com/xedich; student project travel planner)" },
});

// Wikimedia rate-limit khá gắt với IP lạ → retry 429/5xx, tôn trọng Retry-After
const wikiGet = async (url, config) => {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await wikiHttp.get(url, config);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < 4) {
        const retryAfter = Number(err.response?.headers?.["retry-after"]) || 0;
        await sleep(Math.max(retryAfter * 1000, 3000 * attempt));
      }
    }
  }
  throw lastErr;
};

// "https://en.wikipedia.org/wiki/Dragon%20Bridge%20(Da%20Nang)" → { lang: "en", title: "Dragon Bridge (Da Nang)" }
const parseWikiUrl = (url) => {
  try {
    const u = new URL(url);
    const lang = u.hostname.split(".")[0];
    const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
    return title ? { lang, title } : null;
  } catch {
    return null;
  }
};

// Bài tương ứng tiếng Việt của 1 bài wiki (null nếu chưa có bài viWiki)
const findViTitle = async (lang, title) => {
  const { data } = await wikiGet(`https://${lang}.wikipedia.org/w/api.php`, {
    params: {
      action: "query", prop: "langlinks", lllang: "vi", titles: title,
      redirects: 1, format: "json", formatversion: 2,
    },
  });
  return data?.query?.pages?.[0]?.langlinks?.[0]?.title ?? null;
};

// Tóm tắt bài wiki (REST API): extract + thumbnail
const fetchSummary = async (lang, title) => {
  const { data } = await wikiGet(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`
  );
  return data ?? null;
};

// "Cầu Rồng (Đà Nẵng)" → "Cầu Rồng" — bỏ phần định hướng trong ngoặc
const cleanTitle = (t) => (t || "").replace(/\s*\(.*\)\s*$/, "").trim();

// Wikimedia (thay đổi hạ tầng 2025-2026, xem https://www.mediawiki.org/wiki/Common_thumbnail_sizes)
// giờ CHỈ chấp nhận hotlink thumbnail đúng 1 trong các width chuẩn dưới đây — request width tuỳ ý
// (vd link REST API summary trả về "/400px-...") bị CDN trả 400, ảnh vỡ trên FE dù link "có vẻ" hợp lệ.
// → làm tròn lên width chuẩn gần nhất trước khi lưu.
const WIKIMEDIA_STANDARD_THUMB_WIDTHS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];
const normalizeWikimediaThumbWidth = (url) => {
  const m = /^(.*\/)(\d+)(px-[^/]+)$/.exec(url);
  if (!m) return url;
  const width = Number(m[2]);
  if (WIKIMEDIA_STANDARD_THUMB_WIDTHS.includes(width)) return url;
  const standard =
    WIKIMEDIA_STANDARD_THUMB_WIDTHS.find((w) => w >= width) ??
    WIKIMEDIA_STANDARD_THUMB_WIDTHS[WIKIMEDIA_STANDARD_THUMB_WIDTHS.length - 1];
  return `${m[1]}${standard}${m[3]}`;
};

// ─── Bước 1: Wikipedia ────────────────────────────────────────────────────────
const enrichFromWikipedia = async () => {
  const places = await placeRepository.findNeedingWikiEnrich();
  console.log(`[PlaceEnrich] Wikipedia: ${places.length} điểm cần enrich`);

  let ok = 0;
  for (const place of places) {
    const parsed = parseWikiUrl(place.wikipedia);
    if (!parsed) continue;

    try {
      const viTitle = parsed.lang === "vi" ? parsed.title : await findViTitle(parsed.lang, parsed.title);
      const fields = {};

      if (viTitle) {
        const summary = await fetchSummary("vi", viTitle);
        if (summary) {
          if (place.name_vi == null) fields.nameVi = cleanTitle(summary.title || viTitle).slice(0, 255) || null;
          if (place.description_vi == null && summary.extract) {
            fields.descriptionVi = summary.extract.slice(0, 5000);
          }
          if (place.image == null && summary.thumbnail?.source) {
            fields.image = normalizeWikimediaThumbWidth(summary.thumbnail.source).slice(0, 500);
          }
        }
      }

      // Không có bài viWiki (hoặc bài thiếu ảnh) → bù ảnh từ thumbnail bài gốc
      if (place.image == null && !fields.image) {
        const enSummary = await fetchSummary(parsed.lang, parsed.title);
        if (enSummary?.thumbnail?.source) {
          fields.image = normalizeWikimediaThumbWidth(enSummary.thumbnail.source).slice(0, 500);
        }
      }

      if (Object.keys(fields).length > 0) {
        await placeRepository.updateEnrichment(place.id, fields);
        ok++;
      }
    } catch (err) {
      console.warn(`[PlaceEnrich] Wikipedia lỗi "${place.name}":`, err.message);
    }
    await sleep(WIKI_DELAY_MS);
  }

  console.log(`[PlaceEnrich] Wikipedia: cập nhật ${ok}/${places.length} điểm`);
  return ok;
};

// ─── Bước 2: Gemini dịch phần còn thiếu ───────────────────────────────────────
const translateBatch = async (batch) => {
  const items = batch.map((p) => ({
    id: p.id,
    name: p.name,
    // Cắt bớt mô tả đầu vào — bản dịch tóm lược ~900 ký tự là đủ cho card UI
    description: p.description ? String(p.description).slice(0, 900) : null,
  }));

  const prompt = `Bạn là biên dịch viên du lịch. Dịch tên và mô tả các địa điểm du lịch Việt Nam sau sang tiếng Việt tự nhiên.
Quy tắc:
- "name_vi": dùng tên tiếng Việt thông dụng của địa danh (vd "Dragon Bridge" → "Cầu Rồng", "Marble Mountains" → "Ngũ Hành Sơn"). Tên riêng không có tên Việt thông dụng thì GIỮ NGUYÊN.
- "description_vi": dịch mô tả sang tiếng Việt trôi chảy, giữ thông tin chính; null nếu description là null.
- Trả về JSON mảng: [{"id": số, "name_vi": "...", "description_vi": "..." | null}] — đủ mọi id đầu vào, không thêm gì khác.

Dữ liệu: ${JSON.stringify(items)}`;

  const result = await generateJSON(prompt);
  return Array.isArray(result) ? result : [];
};

const enrichFromGemini = async () => {
  if (!process.env.GEMINI_KEY) {
    console.warn("[PlaceEnrich] Bỏ qua bước Gemini — chưa cấu hình GEMINI_KEY");
    return 0;
  }

  const places = await placeRepository.findNeedingTranslation();
  console.log(`[PlaceEnrich] Gemini: ${places.length} điểm cần dịch`);

  let ok = 0;
  for (let i = 0; i < places.length; i += GEMINI_BATCH_SIZE) {
    const batch = places.slice(i, i + GEMINI_BATCH_SIZE);
    try {
      // llm.client chỉ retry nhanh (2s) — chưa đủ cho quota theo phút, nên retry
      // thêm ở đây với thời gian nghỉ dài
      let translated;
      for (let attempt = 1; ; attempt++) {
        try {
          translated = await translateBatch(batch);
          break;
        } catch (err) {
          if (err.response?.status !== 429 || attempt >= 3) throw err;
          console.log(`[PlaceEnrich] Gemini 429 — nghỉ ${GEMINI_429_WAIT_MS / 1000}s rồi thử lại...`);
          await sleep(GEMINI_429_WAIT_MS);
        }
      }
      for (const t of translated) {
        if (!batch.some((p) => p.id === t.id)) continue; // chống LLM bịa id
        await placeRepository.updateEnrichment(t.id, {
          nameVi: t.name_vi ? String(t.name_vi).slice(0, 255) : null,
          descriptionVi: t.description_vi ? String(t.description_vi).slice(0, 5000) : null,
        });
        ok++;
      }
    } catch (err) {
      console.warn(`[PlaceEnrich] Gemini lỗi batch ${i / GEMINI_BATCH_SIZE + 1}:`, err.message);
    }
    if (i + GEMINI_BATCH_SIZE < places.length) await sleep(GEMINI_DELAY_MS);
  }

  console.log(`[PlaceEnrich] Gemini: dịch xong ${ok}/${places.length} điểm`);
  return ok;
};

// ─── enrichAllPlaces — gọi sau syncAllCities hoặc trigger thủ công ────────────
const enrichAllPlaces = async () => {
  console.log(`[PlaceEnrich] Bắt đầu enrich lúc ${new Date().toISOString()}`);
  const wiki = await enrichFromWikipedia();
  const gemini = await enrichFromGemini();
  console.log(`[PlaceEnrich] Hoàn thành — Wikipedia: ${wiki}, Gemini: ${gemini}`);
  return { wiki, gemini };
};

module.exports = { enrichAllPlaces, enrichFromWikipedia, enrichFromGemini, normalizeWikimediaThumbWidth };
