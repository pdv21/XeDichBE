const db = require("../../shared/config/database");

const createJob = async (tripId, userId) => {
  const [result] = await db.execute(
    "INSERT INTO ai_jobs (trip_id, user_id, type, status) VALUES (?, ?, 'plan_trip', 'queued')",
    [tripId, userId]
  );
  return result.insertId;
};

const updateJobStatus = async (jobId, status, error = null) => {
  await db.execute(
    "UPDATE ai_jobs SET status = ?, error = ? WHERE id = ?",
    [status, error ? String(error).slice(0, 1000) : null, jobId]
  );
};

const findJobById = async (jobId) => {
  const [rows] = await db.execute(
    "SELECT id, trip_id, user_id, type, status, error, created_at, updated_at FROM ai_jobs WHERE id = ? LIMIT 1",
    [jobId]
  );
  return rows[0] ?? null;
};

// Job đang chờ/chạy của 1 trip — dùng chống double-enqueue khi user bấm plan liên tục
const findActiveJobByTrip = async (tripId) => {
  const [rows] = await db.execute(
    `SELECT id, status FROM ai_jobs
     WHERE trip_id = ? AND status IN ('queued', 'processing')
     ORDER BY id DESC LIMIT 1`,
    [tripId]
  );
  return rows[0] ?? null;
};

const updateTripStatus = async (tripId, status) => {
  await db.execute("UPDATE trips SET status = ? WHERE id = ?", [status, tripId]);
};

const saveTripAiSummary = async (tripId, aiSummary) => {
  await db.execute("UPDATE trips SET ai_summary = ? WHERE id = ?", [
    JSON.stringify(aiSummary), tripId,
  ]);
};

const saveTripBudgetSummary = async (tripId, budgetSummary) => {
  await db.execute("UPDATE trips SET budget_summary = ? WHERE id = ?", [
    JSON.stringify(budgetSummary), tripId,
  ]);
};

const saveTripAdjustments = async (tripId, adjustments) => {
  await db.execute("UPDATE trips SET itinerary_adjustments = ? WHERE id = ?", [
    JSON.stringify(adjustments), tripId,
  ]);
};

module.exports = {
  createJob, updateJobStatus, findJobById, findActiveJobByTrip,
  updateTripStatus, saveTripAiSummary, saveTripBudgetSummary, saveTripAdjustments,
};
