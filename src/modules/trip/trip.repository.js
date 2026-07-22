const db = require("../../shared/config/database");

const createTrip = async ({ userId, locationId, title, startDate, endDate, budgetTotal, numPeople, mealCostVnd }) => {
  const [result] = await db.execute(
    `INSERT INTO trips (user_id, location_id, title, start_date, end_date, budget_total, num_people, meal_cost_vnd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, locationId, title ?? null, startDate, endDate, budgetTotal ?? null, numPeople ?? 1, mealCostVnd ?? null]
  );
  return result.insertId;
};

const findByIdWithLocation = async (tripId) => {
  const [rows] = await db.execute(
    `SELECT t.*, l.city_code, l.city_name
     FROM trips t JOIN locations l ON t.location_id = l.id
     WHERE t.id = ?
     LIMIT 1`,
    [tripId]
  );
  return rows[0] ?? null;
};

const findByUser = async (userId, { limit, offset }) => {
  const safeLimit = Math.max(parseInt(limit, 10) || 20, 1);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const [rows] = await db.execute(
    `SELECT t.*, l.city_code, l.city_name
     FROM trips t JOIN locations l ON t.location_id = l.id
     WHERE t.user_id = ?
     ORDER BY t.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId]
  );

  const [[{ total }]] = await db.execute(
    "SELECT COUNT(*) AS total FROM trips WHERE user_id = ?",
    [userId]
  );

  return { rows, total };
};

const updateTrip = async (tripId, fields) => {
  const columns = [];
  const values = [];
  const mapping = {
    locationId: "location_id",
    title: "title",
    startDate: "start_date",
    endDate: "end_date",
    budgetTotal: "budget_total",
    numPeople: "num_people",
    mealCostVnd: "meal_cost_vnd",
    status: "status",
  };

  for (const [key, column] of Object.entries(mapping)) {
    if (fields[key] !== undefined) {
      columns.push(`${column} = ?`);
      values.push(fields[key]);
    }
  }
  if (columns.length === 0) return false;

  values.push(tripId);
  const [result] = await db.execute(
    `UPDATE trips SET ${columns.join(", ")} WHERE id = ?`,
    values
  );
  return result.affectedRows > 0;
};

const deleteTrip = async (tripId) => {
  const [result] = await db.execute("DELETE FROM trips WHERE id = ?", [tripId]);
  return result.affectedRows > 0;
};

module.exports = { createTrip, findByIdWithLocation, findByUser, updateTrip, deleteTrip };
