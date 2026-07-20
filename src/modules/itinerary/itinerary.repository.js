const db = require("../../shared/config/database");

// Lưu lịch trình trong 1 transaction: xoá lịch cũ → insert lịch mới →
// đổi status trip. Lỗi giữa chừng thì rollback, trip không bị mất lịch cũ
// mà không có lịch mới.
const saveItinerary = async (tripId, activities) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute("DELETE FROM trip_activities WHERE trip_id = ?", [tripId]);

    if (activities.length > 0) {
      const placeholders = activities.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      const values = activities.flatMap((a) => [
        tripId, a.place.id, a.day_index, a.order_index,
        a.start_time, a.activity_type, a.score,
      ]);
      await conn.execute(
        `INSERT INTO trip_activities
           (trip_id, place_id, day_index, order_index, start_time, activity_type, score)
         VALUES ${placeholders}`,
        values
      );
    }

    await conn.execute("UPDATE trips SET status = 'planned' WHERE id = ?", [tripId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
};

const findByTripId = async (tripId) => {
  const [rows] = await db.execute(
    `SELECT ta.day_index, ta.order_index, ta.start_time, ta.activity_type, ta.score,
            p.id AS place_id, p.name, p.name_vi, p.category, p.kinds, p.address,
            p.latitude, p.longitude, p.rate, p.description, p.description_vi,
            p.image, p.visit_minutes
     FROM trip_activities ta
     JOIN places p ON ta.place_id = p.id
     WHERE ta.trip_id = ?
     ORDER BY ta.day_index ASC, ta.order_index ASC`,
    [tripId]
  );
  return rows;
};

module.exports = { saveItinerary, findByTripId };
