const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const authRoutes = require('./modules/auth/auth.route');
const hotelRoutes = require('./modules/hotel/hotel.routes');

app.use(cookieParser());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/hotels', hotelRoutes);

module.exports = app;