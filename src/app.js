const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const authRoutes = require('./modules/auth/auth.route');
const hotelRoutes = require('./modules/hotel/hotel.routes');
const flightRoutes = require('./modules/flight/test');
const userRoutes = require('./modules/user/user.route');

app.use(cookieParser());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/flights', flightRoutes);
app.use('/hotels', hotelRoutes);
app.use('/users', userRoutes);

module.exports = app;