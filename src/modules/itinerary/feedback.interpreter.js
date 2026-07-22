const { generateJSON } = require("../../shared/config/llm.client");

// Diễn giải góp ý tự do của user (vd "bớt đi bộ", "bỏ Bitexco", "thêm quán hải sản")
// thành directive có cấu trúc để áp lên pipeline sinh lịch trình hiện có (planTrip):
// loại trừ điểm cụ thể + điều chỉnh pace/interests CHỈ CHO TRIP NÀY (không đổi
// user_preferences toàn cục). Khác với AI Personalization (best-effort, chỉ viết
// text mô tả) — bước này là FUNCTIONAL, lỗi Gemini phải throw để controller báo
// user thử lại, không được âm thầm bỏ qua vì user sẽ tưởng góp ý đã được áp dụng.

const KNOWN_INTERESTS = ["food", "beach", "culture", "nature", "nightlife", "shopping"];
const KNOWN_PACES = ["relaxed", "moderate", "packed"];

const buildPrompt = ({ feedback, currentPace, currentInterests, activityLines }) => {
  return `Bạn là trợ lý lập kế hoạch du lịch. Người dùng đang xem lịch trình chuyến đi đã sinh sẵn và vừa góp ý muốn chỉnh sửa. Hãy diễn giải góp ý thành thay đổi CỤ THỂ.

Lịch trình hiện tại (mỗi dòng: id địa điểm | ngày | loại | tên):
${activityLines}

Sở thích hiện tại: pace="${currentPace}", interests=${JSON.stringify(currentInterests)}
Các interest hợp lệ: ${KNOWN_INTERESTS.join(", ")}
Các pace hợp lệ: ${KNOWN_PACES.join(", ")} (relaxed=ít hoạt động/ngày, packed=nhiều hoạt động/ngày)

Góp ý của người dùng: "${feedback}"

Diễn giải góp ý thành JSON:
{
  "exclude_place_ids": [id các điểm CỤ THỂ trong danh sách trên mà user muốn bỏ khỏi lịch trình — CHỈ lấy id có trong danh sách, không bịa],
  "pace": "relaxed" | "moderate" | "packed" | null (null nếu user không nói gì về nhịp độ; "bớt đi bộ"/"đi chậm hơn" → relaxed hạ 1 mức so với hiện tại; "đi nhiều hơn"/"dày hơn" → packed tăng 1 mức),
  "interests_add": [interest hợp lệ user muốn thêm, rỗng nếu không có],
  "interests_remove": [interest hợp lệ user muốn bớt, rỗng nếu không có],
  "reply_note": "1-2 câu tiếng Việt ngắn gọn giải thích sẽ thay đổi gì trong lần sinh lịch trình tiếp theo"
}
Nếu góp ý không rõ ràng hoặc không match được điểm/interest nào cụ thể, để mảng rỗng và giải thích trong reply_note là sẽ thử tạo lịch trình đa dạng hơn. Chỉ trả JSON, không thêm gì khác.`;
};

const clampArray = (arr, allowed) =>
  Array.isArray(arr) ? [...new Set(arr.filter((v) => allowed.has(v)))] : [];

const interpretFeedback = async ({ feedback, currentPace, currentInterests, activities }) => {
  const trimmed = String(feedback ?? "").trim();
  if (!trimmed) {
    const err = new Error("Vui lòng nhập nội dung góp ý");
    err.statusCode = 400;
    throw err;
  }
  if (trimmed.length > 500) {
    const err = new Error("Góp ý quá dài, tối đa 500 ký tự");
    err.statusCode = 400;
    throw err;
  }

  const validIds = new Set(activities.map((a) => a.place_id));
  const activityLines = activities
    .map((a) => `${a.place_id} | Ngày ${a.day_index} | ${a.activity_type} | ${a.name_vi || a.name}`)
    .join("\n");

  const prompt = buildPrompt({ feedback: trimmed, currentPace, currentInterests, activityLines });
  const result = await generateJSON(prompt);

  if (typeof result !== "object" || result == null) {
    throw new Error("AI trả về sai định dạng khi diễn giải góp ý");
  }

  return {
    exclude_place_ids: Array.isArray(result.exclude_place_ids)
      ? [...new Set(result.exclude_place_ids.map(Number).filter((id) => validIds.has(id)))]
      : [],
    pace: KNOWN_PACES.includes(result.pace) ? result.pace : null,
    interests_add: clampArray(result.interests_add, new Set(KNOWN_INTERESTS)),
    interests_remove: clampArray(result.interests_remove, new Set(KNOWN_INTERESTS)),
    reply_note: typeof result.reply_note === "string" ? result.reply_note.slice(0, 500) : "Đã ghi nhận góp ý, lịch trình mới sẽ áp dụng thay đổi.",
  };
};

module.exports = { interpretFeedback, KNOWN_INTERESTS, KNOWN_PACES };
