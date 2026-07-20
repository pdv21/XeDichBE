const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const app = express();
const authRoutes = require('./modules/auth/auth.route');
const hotelRoutes = require('./modules/hotel_liteapi/hotel.route');
const flightRoutes = require('./modules/flight/test');
const userRoutes = require('./modules/user/user.route');
const placeRoutes = require('./modules/place/place.route');
const tripRoutes = require('./modules/trip/trip.route');
const jobRoutes = require('./modules/itinerary/job.route');
const locationRoutes = require('./modules/location/location.route');
const errorHandler = require('./modules/hotel_liteapi/error.handler');

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/flights', flightRoutes);
app.use('/hotels', hotelRoutes);
app.use('/users', userRoutes);
app.use('/places', placeRoutes);
app.use('/trips', tripRoutes);
app.use('/jobs', jobRoutes);
app.use('/locations', locationRoutes);

app.use(errorHandler);

module.exports = app;