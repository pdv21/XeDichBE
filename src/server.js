require('dotenv').config();

const app = require('./app');
require('./modules/hotel_liteapi/hotel.sync.job');
require('./modules/place/place.sync.job');
require('./modules/itinerary/plan.queue'); // khởi động worker 'trip-plan'
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});