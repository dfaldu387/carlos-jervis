const stamp = () => new Date().toISOString();

const write = (level, message, meta) => {
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    console.log(line, JSON.stringify(meta));
  } else {
    console.log(line);
  }
};

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  debug: (message, meta) => {
    if (process.env.JERVIS_DEBUG) write('debug', message, meta);
  },
};
