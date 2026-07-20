/**
 * Global error handler middleware
 * Đặt sau tất cả routes trong app.js:
 *   app.use(errorHandler);
 */
const errorHandler = (err, req, res, next) => {
  // Lỗi từ LiteAPI (axios error)
  const status = err.statusCode || err.response?.status || 500;
  const message =
    err.message ||
    err.response?.data?.message ||
    "Internal server error";

  return res.status(status).json({ success: false, message });
};

module.exports = errorHandler;