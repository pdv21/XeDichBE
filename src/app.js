const express = require('express');
const app = express();

const authRoutes = require('./modules/auth/auth.route');
const userRoutes = require('./modules/user/user.route');

app.use(express.json());

app.use('/auth', authRoutes);
app.use('/users', userRoutes);

module.exports = app;