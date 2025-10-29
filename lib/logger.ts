import { initializeLogfire, logfireEvent } from './otel';
import { trace } from '@opentelemetry/api';

const LOG_PREFIX = 'VmConsoleLog';
const REDACTED_TEXT = '[REDACTED]';
const SENSITIVE_KEYWORDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'credential',
  'session',
  'cookie',
  'auth',
  'authorization',
  'bearer',
  'key',
] as const;

const levelPriority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof levelPriority;

const hasSensitiveKeyword = (value: string) => {
  const lower = value.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const isLikelySensitiveString = (value: string) => {
  if (!value) {
    return false;
  }

  if (hasSensitiveKeyword(value)) {
    return true;
  }

  if (/^bearer\s+\S+/i.test(value)) {
    return true;
  }

  if (/^[A-Za-z0-9+/=]{32,}$/.test(value) && !/^\d+$/.test(value)) {
    return true;
  }

  return false;
};

const sanitizeValue = (value: unknown, keyHint?: string): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return keyHint && hasSensitiveKeyword(keyHint) ? REDACTED_TEXT : isLikelySensitiveString(value) ? REDACTED_TEXT : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: isLikelySensitiveString(value.message) ? REDACTED_TEXT : value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      result[key] = hasSensitiveKeyword(key) ? REDACTED_TEXT : sanitizeValue(val, key);
    });
    return result;
  }

  return REDACTED_TEXT;
};

const sanitizeMessage = (message: string) => (isLikelySensitiveString(message) ? REDACTED_TEXT : message);

const sanitizeArgs = (args: unknown[]) => args.map((arg) => sanitizeValue(arg));

const getMinimumLevel = (): LogLevel => {
  const raw = process.env.EXPO_PUBLIC_LOG_LEVEL?.toLowerCase();
  if (!raw) {
    return 'debug';
  }

  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }

  return 'debug';
};

let minimumLevel = getMinimumLevel();

const shouldLog = (level: LogLevel) => levelPriority[level] >= levelPriority[minimumLevel];

export type LogOptions = {
  emit2logfire?: boolean;
  allowSensitiveLogging?: boolean;
};

const emit = (level: LogLevel, message: string, options: LogOptions, ...args: unknown[]) => {
  if (!shouldLog(level)) {
    return;
  }

  const allowSensitiveLogging = options.allowSensitiveLogging === true;
  const safeMessage = allowSensitiveLogging ? message : sanitizeMessage(message);
  const safeArgs = allowSensitiveLogging ? args : sanitizeArgs(args);

  const timestamp = new Date().toISOString();
  const prefix = `[${LOG_PREFIX}][${level.toUpperCase()}][${timestamp}]`;

  switch (level) {
    case 'debug':
      console.debug(prefix, safeMessage, ...safeArgs);
      break;
    case 'info':
      console.info(prefix, safeMessage, ...safeArgs);
      break;
    case 'warn':
      console.warn(prefix, safeMessage, ...safeArgs);
      break;
    case 'error':
      console.error(prefix, safeMessage, ...safeArgs);
      break;
    default:
      console.log(prefix, safeMessage, ...safeArgs);
      break;
  }

  // Send to logfire with log level as attribute (if enabled)
  const emit2logfire = options.emit2logfire ?? true;
  if (emit2logfire) {
    const attrs: Record<string, unknown> = {
      level,
      timestamp,
    };

    // Add any additional args as attributes
    if (safeArgs.length > 0) {
      safeArgs.forEach((arg, index) => {
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
          Object.assign(attrs, arg);
        } else {
          attrs[`arg${index}`] = arg;
        }
      });
    }

    logfireEvent(safeMessage, attrs);
  }
};

export const log = {
  async initialize() {
    await initializeLogfire();
  },
  setLevel(level: LogLevel) {
    minimumLevel = level;
  },
  debug(message: string, options: LogOptions = {}, ...args: unknown[]) {
    emit('debug', message, options, ...args);
  },
  info(message: string, options: LogOptions = {}, ...args: unknown[]) {
    emit('info', message, options, ...args);
  },
  warn(message: string, options: LogOptions = {}, ...args: unknown[]) {
    emit('warn', message, options, ...args);
  },
  error(message: string, options: LogOptions = {}, ...args: unknown[]) {
    emit('error', message, options, ...args);
  },
  // Helper for creating spans for hierarchical tracing
  async withSpan<T>(
    name: string,
    fn: () => Promise<T>,
    attrs?: Record<string, unknown>
  ): Promise<T> {
    const tracer = trace.getTracer('vibemachine-tracer');
    const span = tracer.startSpan(name);

    if (attrs) {
      span.setAttributes(attrs as any);
    }

    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2 }); // ERROR
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  },
};

export type Logger = typeof log;
