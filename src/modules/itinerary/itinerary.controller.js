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

module.exports = { planTrip, getJob, getItinerary };
