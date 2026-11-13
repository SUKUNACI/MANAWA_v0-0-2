const { validationResult } = require('express-validator');

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    return res.status(400).json({
      error: firstError.msg,
      details: errors.array().map(e => ({
        field: e.param,
        message: e.msg,
      })),
    });
  }
  next();
}

module.exports = { handleValidationErrors };
