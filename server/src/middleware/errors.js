import { logger } from '../utils/logger.js';

export const notFound = (req, res) => {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
};

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export const errorHandler = (error, req, res, next) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    logger.error('Unhandled request error', { path: req.path, error: error.message });
  }
  res.status(status).json({
    error: status >= 500 ? 'internal_error' : 'request_error',
    message: error.message,
  });
};

export const requestLog = (req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, { role: req.access?.role });
  next();
};
