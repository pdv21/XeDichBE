require('dotenv').config();
const { syncAllCities } = require('./src/modules/hotel/hotel.sync.job');

syncAllCities()
    .then(() => {
        console.log('[HotelSync] Sync hoàn tất');
        process.exit(0);
    })
    .catch((err) => {
        console.error('[HotelSync] Sync thất bại:', err.message);
        process.exit(1);
    });