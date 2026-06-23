const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const authRoutes = require('./modules/auth/auth.route');

app.use(cookieParser());
app.use(express.json());

app.use('/auth', authRoutes);

module.exports = app;