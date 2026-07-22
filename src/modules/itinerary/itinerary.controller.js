const itineraryService = require("./itinerary.service");
const tripService = require("../trip/trip.service");
const jobRepository = require("./job.repository");
const { enqueuePlanJob } = require("./plan.queue");
const response = require("../../shared/utils/response");

const handleError = (res, error, fallbackMessage) => {
  if (error.statusCode) {
    return response.error(res, error.message, error.statusCode);
  }
  console.error("[ItineraryController]", error);
  return response.error(res, fallbackMessage, 500);
};

// POST /trips/:id/plan — bất đồng bộ: tạo job, trả 202 {job_id} ngay,
// client polling GET /jobs/:job_id
const planTrip = async (req, res) => {
  try {
    const tripId = Number(req.params.id);
    await tripService.getOwnedTrip(req.user.id, tripId); // 404 nếu không phải của mình

    // Chống double-enqueue: đã có job đang chờ/chạy thì trả lại job đó
    const active = await jobRepository.findActiveJobByTrip(tripId);
    if (active) {
      return response.ok(res, { job_id: active.id, status: active.status }, "Lịch trình đang được sinh, vui lòng chờ", 202);
    }

    const jobId = await jobRepository.createJob(tripId, req.user.id);
    await enqueuePlanJob({ jobId, tripId, userId: req.user.id });

    return response.ok(res, { job_id: jobId, status: "queued" }, "Đã nhận yêu cầu sinh lịch trình — polling GET /jobs/:job_id để theo dõi", 202);
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi sinh lịch trình");
  }
};

// GET /jobs/:id — polling trạng thái job
const getJob = async (req, res) => {
  try {
    const job = await jobRepository.findJobById(Number(req.params.id));
    if (!job || job.user_id !== req.user.id) {
      return response.error(res, "Không tìm thấy job", 404);
    }
    return response.ok(res, {
      job_id: job.id,
      trip_id: job.trip_id,
      type: job.type,
      status: job.status,
      error: job.error,
      created_at: job.created_at,
      updated_at: job.updated_at,
    }, "Lấy trạng thái job thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi lấy trạng thái job");
  }
};

const getItinerary = async (req, res) => {
  try {
    const result = await itineraryService.getItinerary(req.user.id, Number(req.params.id));
    return response.ok(res, result, "Lấy lịch trình thành công");
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi lấy lịch trình");
  }
};

// POST /trips/:id/adjust {feedback} — diễn giải góp ý (Gemini, functional nên
// lỗi throw thẳng chứ không best-effort), lưu vào itinerary_adjustments, rồi
// enqueue LẠI đúng job 'trip-plan' sẵn có để sinh lịch trình mới áp dụng thay đổi.
// Trả kèm changes_summary ngay (không cần đợi job xong) để FE hiện xác nhận sớm.
const adjustTrip = async (req, res) => {
  try {
    const tripId = Number(req.params.id);

    // Chống double-enqueue giống planTrip — không cho góp ý thêm khi đang có job chạy dở
    const active = await jobRepository.findActiveJobByTrip(tripId);
    if (active) {
      return response.error(res, "Lịch trình đang được sinh, vui lòng đợi xong rồi góp ý tiếp", 409);
    }

    const { changes_summary } = await itineraryService.submitFeedback(req.user.id, tripId, req.body.feedback);

    const jobId = await jobRepository.createJob(tripId, req.user.id);
    await enqueuePlanJob({ jobId, tripId, userId: req.user.id });

    return response.ok(
      res,
      { job_id: jobId, status: "queued", changes_summary },
      "Đã ghi nhận góp ý — đang sinh lại lịch trình",
      202
    );
  } catch (error) {
    return handleError(res, error, "Đã có lỗi xảy ra khi xử lý góp ý chỉnh sửa");
  }
};

module.exports = { planTrip, getJob, getItinerary, adjustTrip };
