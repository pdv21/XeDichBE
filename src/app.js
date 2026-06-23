const express = require('express');
const app = express();

const authRoutes = require('./modules/auth/auth.route');

app.use(express.json());

app.use('/auth', authRoutes);

module.exports = app;