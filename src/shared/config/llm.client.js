const axios = require("axios");
const https = require("https");

// LLM client trừu tượng — hiện dùng Google Gemini (free tier 1500 req/ngày).
// Đổi provider chỉ cần sửa file này + env, các module gọi generateJSON không đổi.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODEL = process.env.LLM_MODEL || "gemini-flash-latest";

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

const client = axios.create({
  baseURL: GEMINI_BASE,
  timeout: 60_000, // LLM có thể chậm — 60s rồi bỏ cuộc (AI là best-effort)
  httpsAgent,
  headers: { "x-goog-api-key": process.env.GEMINI_KEY || "" },
});

const withRetry = async (fn, { maxAttempts = 2, baseDelayMs = 2000 } = {}) => {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      // retry lỗi mạng/5xx/429 (free tier hay dính rate limit theo phút)
      if (status && status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastErr;
};

// Gửi prompt, nhận về object JSON đã parse.
// responseMimeType application/json ép Gemini chỉ trả JSON hợp lệ, nhưng free-tier
// model thỉnh thoảng vẫn trả JSON lỗi cú pháp (đã gặp thực tế: số tiền viết kèm dấu
// phẩy ngăn cách hàng nghìn, hoặc quote chưa đóng đúng) — parse lỗi được coi là lỗi
// TẠM THỜI giống 429, retry cả request (không chỉ HTTP) vì output không deterministic,
// thử lại thường ra JSON hợp lệ. Quan trọng với các nơi gọi generateJSON theo kiểu
// functional (lỗi phải throw cho user biết, khác ai.personalizer.js vốn best-effort).
// thinkingBudget 1 (tối thiểu còn được model hiện tại chấp nhận — "gemini-flash-latest"
// đã đổi sang bản mới hơn không còn cho phép 0, thấy lỗi 400 INVALID_ARGUMENT thực tế
// khi test; 1 xấp xỉ tắt "suy nghĩ" nhiều nhất có thể) — task viết mô tả không cần, đỡ chậm.
const generateJSON = async (prompt) => {
  return withRetry(async () => {
    const res = await client.post(`/models/${MODEL}:generateContent`, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 1 },
        maxOutputTokens: 4096,
      },
    });

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("LLM không trả về nội dung");
    try {
      return JSON.parse(text);
    } catch (err) {
      throw Object.assign(new Error(`LLM trả về JSON không hợp lệ: ${err.message}`), {
        // Đánh dấu để withRetry coi như lỗi tạm thời (retry), giống status 429
        response: { status: 429 },
      });
    }
  }, { maxAttempts: 5, baseDelayMs: 1200 });
};

module.exports = { generateJSON };
