const db = require('../../shared/config/database');

const getLocationKey = async (cityCode) => {
    const [rows] = await db.execute(
        `
        SELECT location_key
        FROM locations
        WHERE city_code = ?
          AND is_active = 1
        LIMIT 1
        `,
        [cityCode]
    );

    return rows[0]?.location_key || null;
};

const getAllLocations = async () => {
    const [rows] = await db.execute(
        `
        SELECT id, city_code, city_name, location_key
        FROM locations
        WHERE is_active = 1
        `
    );

    return rows;
};

module.exports = {
    getLocationKey,
    getAllLocations
};