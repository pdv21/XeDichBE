require('dotenv').config();

const app = require('./app');
require('./modules/hotel/hotel.sync.job');
const { scheduleRateCacheJobs } = require('./modules/hotel/hotel.rate.queue');
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // scheduleRateCacheJobs();
});