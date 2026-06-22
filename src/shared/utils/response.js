const ok = (res, data = null, message = 'Thành công', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const created = (res, data = null, message = 'Tạo thành công') => {
  return res.status(201).json({ success: true, message, data });
};

const paginated = (res, data, meta, message = 'Thành công') => {
  return res.status(200).json({ success: true, message, data, meta });
};

const error = (res, message = 'Đã có lỗi xảy ra', statusCode = 500, errors = null) => {
  const body = { success: false, message, data: null };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { ok, created, paginated, error };
