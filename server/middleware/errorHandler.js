const logger = require('../utils/logger');
const { uniqueFieldLabel } = require('../utils/prismaError');

const errorHandler = (err, req, res, next) => {
  // Prisma known errors
  if (err.code === 'P2002') {
    const field = uniqueFieldLabel(err.meta?.target);
    logger.error(`[${req.method}] ${req.path} — P2002 unique violation on ${JSON.stringify(err.meta?.target)}`);
    return res.status(409).json({ error: `A record with this ${field} already exists.` });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found.' });
  }
  if (err.code === 'P2003') {
    return res.status(400).json({ error: 'Invalid reference: related record does not exist.' });
  }

  // Validation errors
  if (err.name === 'ZodError') {
    return res.status(422).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // Generic
  const statusCode = err.statusCode || 500;
  const message = statusCode < 500 ? err.message : 'Internal server error';

  if (statusCode >= 500) {
    logger.error(`[${req.method}] ${req.path} — ${err.stack || err.message}`);
  }

  res.status(statusCode).json({ error: message });
};

// Attach status code helper
const createError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

module.exports = errorHandler;
module.exports.createError = createError;
