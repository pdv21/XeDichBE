const { Queue, Worker } = require("bullmq");
const redis = require("../../shared/config/redis");
const itineraryService = require("./itinerary.service");
const jobRepository = require("./job.repository");
const { generateAiSummary } = require("./ai.personalizer");

// Queue sinh lịch trình bất đồng bộ theo thiết kế:
// POST /trips/:id/plan → tạo ai_jobs row + enqueue → trả 202 {job_id}
// → client polling GET /jobs/:id đến khi completed/failed
// → GET /trips/:id/itinerary lấy kết quả (kèm ai_summary).
const QUEUE_NAME = "trip-plan";

const planQueue = new Queue(QUEUE_NAME, { connection: redis });

// Enqueue 1 job sinh lịch trình. jobId của BullMQ đặt theo ai_jobs.id để dễ đối chiếu.
const enqueuePlanJob = async ({ jobId, tripId, userId }) => {
  await planQueue.add(
    "plan-trip",
    { jobId, tripId, userId },
    {
      jobId: `plan-${jobId}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true, // trạng thái thật nằm ở bảng ai_jobs, không cần giữ job rác trong Redis
    }
  );
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { jobId, tripId, userId } = job.data;
    console.log(`[PlanQueue] Bắt đầu job #${jobId} (trip ${tripId})`);

    await jobRepository.updateJobStatus(jobId, "processing");
    await jobRepository.updateTripStatus(tripId, "planning");

    try {
      // Bước 1-4 + 6: sinh lịch trình + lưu (đã chuyển trip → planned bên trong)
      const itinerary = await itineraryService.planTrip(userId, tripId);

      // Bước 5 — AI Personalization: BEST-EFFORT, lỗi không làm fail job
      try {
        const aiSummary = await generateAiSummary(itinerary, itinerary._preferences ?? {});
        await jobRepository.saveTripAiSummary(tripId, aiSummary);
        console.log(`[PlanQueue] Job #${jobId}: AI summary OK`);
      } catch (aiErr) {
        console.warn(`[PlanQueue] Job #${jobId}: AI summary lỗi (bỏ qua):`, aiErr.message);
      }

      await jobRepository.updateJobStatus(jobId, "completed");
      console.log(`[PlanQueue] Hoàn thành job #${jobId}`);
    } catch (err) {
      await jobRepository.updateJobStatus(jobId, "failed", err.message);
      await jobRepository.updateTripStatus(tripId, "failed");
      console.error(`[PlanQueue] Job #${jobId} thất bại:`, err.message);
      throw err; // để BullMQ ghi nhận fail (retry theo attempts)
    }
  },
  { connection: redis, concurrency: 2 }
);

worker.on("error", (err) => console.error("[PlanQueue] Worker error:", err.message));

console.log("[PlanQueue] Worker 'trip-plan' đã sẵn sàng");

module.exports = { enqueuePlanJob, planQueue };
