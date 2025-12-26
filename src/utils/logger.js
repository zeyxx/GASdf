const config = require('./config');

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = config.IS_DEV ? LEVELS.debug : LEVELS.info;

function formatLog(level, context, message, data = {}) {
  const timestamp = new Date().toISOString();

  if (config.IS_DEV) {
    // Human readable in dev
    const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    return `${timestamp} [${level.toUpperCase()}] [${context}] ${message}${dataStr}`;
  }

  // JSON in prod for log aggregators
  return JSON.stringify({
    timestamp,
    level,
    context,
    message,
    ...data,
  });
}

function shouldLog(level) {
  return LEVELS[level] <= currentLevel;
}

const logger = {
  error(context, message, data = {}) {
    if (shouldLog('error')) {
      console.error(formatLog('error', context, message, data));
    }
  },

  warn(context, message, data = {}) {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', context, message, data));
    }
  },

  info(context, message, data = {}) {
    if (shouldLog('info')) {
      console.log(formatLog('info', context, message, data));
    }
  },

  debug(context, message, data = {}) {
    if (shouldLog('debug')) {
      console.log(formatLog('debug', context, message, data));
    }
  },

  // Request logger middleware
  requestLogger(req, res, next) {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || generateRequestId();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 400 ? 'warn' : 'info';

      logger[level]('HTTP', `${req.method} ${req.path}`, {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip || req.headers['x-forwarded-for'],
      });
    });

    next();
  },
};

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = logger;
