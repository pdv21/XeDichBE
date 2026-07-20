const { generateJSON } = require("../../shared/config/llm.client");

// ─── Bước AI Personalization (bước 5 pipeline) ────────────────────────────────
// Nhận lịch trình thô đã sinh bởi planning.engine, nhờ Gemini viết tóm tắt
// từng ngày + tips thực tế bằng tiếng Việt. BEST-EFFORT: lỗi AI không làm
// fail job — lịch trình vẫn dùng được, ai_summary để NULL.

const buildPrompt = ({ city, startDate, endDate, numPeople, budgetTotal, interests, pace, days }) => {
  const dayLines = days
    .map((d) => {
      const acts = d.activities
        .map((a) => `  - ${a.start_time?.slice(0, 5)} [${a.type === "meal" ? "ăn" : "tham quan"}] ${a.place.name}${a.place.kinds ? ` (${a.place.kinds.split(",").slice(0, 3).join(",")})` : ""}`)
        .join("\n");
      return `Ngày ${d.day_index} (${d.date}):\n${acts}`;
    })
    .join("\n");

  return `Bạn là hướng dẫn viên du lịch Việt Nam giàu kinh nghiệm. Dưới đây là lịch trình du lịch ${city} từ ${startDate} đến ${endDate} cho ${numPeople} người${budgetTotal ? `, ngân sách ${budgetTotal} USD` : ""}${interests?.length ? `, sở thích: ${interests.join(", ")}` : ""}, nhịp độ: ${pace}.

${dayLines}

Hãy trả về JSON đúng schema sau (viết TIẾNG VIỆT tự nhiên, thực tế, không sáo rỗng):
{
  "general_tips": ["3-5 lời khuyên thực tế cho chuyến đi này (thời tiết mùa này, di chuyển, giá cả, lưu ý địa phương)"],
  "days": [
    {
      "day_index": 1,
      "title": "tiêu đề ngắn gọn hấp dẫn cho ngày",
      "summary": "2-3 câu tóm tắt hành trình ngày này, nêu điểm nhấn đáng chú ý nhất"
    }
  ],
  "food_suggestions": ["2-4 món đặc sản ${city} nên thử, kèm gợi ý ăn ở đâu nếu biết"]
}
Chỉ trả về JSON, đủ mọi ngày trong lịch trình.`;
};

const generateAiSummary = async (itinerary, preferences) => {
  let interests = preferences.interests ?? [];
  if (typeof interests === "string") {
    try { interests = JSON.parse(interests); } catch { interests = []; }
  }

  const prompt = buildPrompt({
    city: itinerary.city,
    startDate: String(itinerary.start_date).slice(0, 10),
    endDate: String(itinerary.end_date).slice(0, 10),
    numPeople: itinerary.num_people ?? 1,
    budgetTotal: itinerary.budget_total,
    interests,
    pace: preferences.pace ?? "moderate",
    days: itinerary.days,
  });

  const result = await generateJSON(prompt);

  // Validate tối thiểu để không lưu rác vào DB
  if (!result || !Array.isArray(result.days)) {
    throw new Error("AI trả về sai schema");
  }
  return {
    general_tips: Array.isArray(result.general_tips) ? result.general_tips.slice(0, 6) : [],
    days: result.days
      .filter((d) => d.day_index && d.summary)
      .map((d) => ({ day_index: d.day_index, title: d.title ?? null, summary: d.summary })),
    food_suggestions: Array.isArray(result.food_suggestions) ? result.food_suggestions.slice(0, 6) : [],
  };
};

module.exports = { generateAiSummary };
