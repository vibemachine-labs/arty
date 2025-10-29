// otel.ts
import { trace, type Tracer } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import { getLogfireApiKey, getLogfireEnabled } from "./secure-storage";
import { log } from "./logger";

let tracer: Tracer | null = null;
let isInitialized = false;

// Initialize OpenTelemetry tracing with Pydantic Logfire
export async function initializeLogfire(): Promise<void> {
  if (isInitialized) {
    log.info("Logfire tracing already initialized", { emit2logfire: false });
    return;
  }

  try {
    const enabled = await getLogfireEnabled();
    if (!enabled) {
      log.info("Logfire tracing is disabled", { emit2logfire: false });
      return;
    }

    const apiKey = await getLogfireApiKey();
    if (!apiKey || apiKey.length === 0) {
      log.warn("Logfire tracing is enabled but no API key is configured", { emit2logfire: false });
      return;
    }

    log.info("Initializing Logfire tracing...", { emit2logfire: false });

    // Create OTLP exporter with Pydantic Logfire endpoint
    const exporter = new OTLPTraceExporter({
      url: "https://logfire-us.pydantic.dev/v1/traces",
      headers: {
        Authorization: apiKey,
      },
    });

    // Create a minimal resource with service name
    // Using a plain object to avoid React Native compatibility issues with Resource class
    const resource = {
      attributes: {
        "service.name": "vibemachine",
      },
    };

    // Create the tracer provider with spanProcessors passed in constructor
    const provider = new BasicTracerProvider({
      resource: resource as any,
      spanProcessors: [new BatchSpanProcessor(exporter)],
    });

    // Register the provider globally
    trace.setGlobalTracerProvider(provider);

    // Get tracer instance
    tracer = trace.getTracer("vibemachine-tracer");
    isInitialized = true;

    log.info("✅ Logfire tracing initialized successfully", { emit2logfire: false });
  } catch (error) {
    log.error("Failed to initialize Logfire tracing:", { emit2logfire: false }, error);
  }
}

// Log an event to Pydantic Logfire
export function logfireEvent(name: string, attrs?: Record<string, unknown>): void {
  if (!isInitialized || !tracer) {
    log.debug("Logfire tracing not initialized, skipping event:", { emit2logfire: false }, name);
    return;
  }

  try {
    const span = tracer.startSpan(name);
    if (attrs) span.setAttributes(attrs as any);
    span.end();
  } catch (error) {
    log.error("Failed to log event to Logfire:", { emit2logfire: false }, error);
  }
}

// Check if Logfire tracing is initialized
export function isLogfireInitialized(): boolean {
  return isInitialized;
}
