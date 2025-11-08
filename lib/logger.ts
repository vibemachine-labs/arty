import { initializeLogfire, logfireEvent, registerLogfireLogger } from './otel';
import { trace } from '@opentelemetry/api';
import { loadLogRedactionDisabled, saveLogRedactionDisabled } from './developerSettings';

const LOG_PREFIX = 'VmConsoleLog';
const REDACTED_TEXT = '[REDACTED]';
const SENSITIVE_KEYWORDS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'session',
  'cookie',
  'auth',
  'authorization',
  'bearer',
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
let redactionEnabled = true;

type RedactionChangePayload = {
  enabled: boolean;
  disabled: boolean;
  updatedAt: string;
};

type RedactionChangeListener = (payload: RedactionChangePayload) => void;
const redactionListeners = new Set<RedactionChangeListener>();

const buildRedactionPayload = (): RedactionChangePayload => ({
  enabled: redactionEnabled,
  disabled: !redactionEnabled,
  updatedAt: new Date().toISOString(),
});

const notifyRedactionListeners = () => {
  const payload = buildRedactionPayload();
  redactionListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      console.error(`[${LOG_PREFIX}] Failed to notify redaction listener`, error);
    }
  });
};

type SetRedactionOptions = {
  persist?: boolean;
  silent?: boolean;
};

const shouldLog = (level: LogLevel) => levelPriority[level] >= levelPriority[minimumLevel];

export type LogOptions = {
  emit2logfire?: boolean;
  allowSensitiveLogging?: boolean;
};

const emit = (level: LogLevel, message: string, options: LogOptions, ...args: unknown[]) => {
  if (!shouldLog(level)) {
    return;
  }

  const applyRedaction = redactionEnabled && options.allowSensitiveLogging !== true;
  const safeMessage = applyRedaction ? sanitizeMessage(message) : message;
  const safeArgs = applyRedaction ? sanitizeArgs(args) : args;

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

    if (attrs.is_native_logger === undefined) {
      attrs.is_native_logger = false;
    }

    logfireEvent(safeMessage, attrs);
  }
};

const hydrateRedactionPreference = async () => {
  try {
    const disabled = await loadLogRedactionDisabled();
    redactionEnabled = !disabled;
    notifyRedactionListeners();
  } catch (error) {
    console.warn(`[${LOG_PREFIX}] Failed to hydrate log redaction preference`, error);
  }
};

void hydrateRedactionPreference();

export const log = {
  async initialize() {
    await initializeLogfire();
  },
  setLevel(level: LogLevel) {
    minimumLevel = level;
  },
  async setRedactionEnabled(enabled: boolean, options: SetRedactionOptions = {}) {
    redactionEnabled = enabled;

    if (options.silent !== true) {
      notifyRedactionListeners();
    }

    if (options.persist) {
      try {
        await saveLogRedactionDisabled(!enabled);
      } catch (error) {
        console.warn(`[${LOG_PREFIX}] Failed to persist log redaction preference`, error);
      }
    }
  },
  isRedactionEnabled() {
    return redactionEnabled;
  },
  onRedactionPreferenceChange(listener: RedactionChangeListener) {
    redactionListeners.add(listener);
    // Immediately inform listener of current state
    listener(buildRedactionPayload());
    return () => {
      redactionListeners.delete(listener);
    };
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

registerLogfireLogger(log);

export type Logger = typeof log;
