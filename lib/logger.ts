import { initializeLogfire, logfireEvent } from './otel';
import { trace } from '@opentelemetry/api';

const LOG_PREFIX = 'VmConsoleLog';

const levelPriority = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof levelPriority;

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
};

const emit = (level: LogLevel, message: string, options: LogOptions, ...args: unknown[]) => {
  if (!shouldLog(level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[${LOG_PREFIX}][${level.toUpperCase()}][${timestamp}]`;

  switch (level) {
    case 'debug':
      console.debug(prefix, message, ...args);
      break;
    case 'info':
      console.info(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
    default:
      console.log(prefix, message, ...args);
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
    if (args.length > 0) {
      args.forEach((arg, index) => {
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
          Object.assign(attrs, arg);
        } else {
          attrs[`arg${index}`] = arg;
        }
      });
    }

    logfireEvent(message, attrs);
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
