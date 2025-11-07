import { Platform } from "react-native";
import { trace, type Tracer } from "@opentelemetry/api";
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import VmWebrtcModule from "../modules/vm-webrtc";
import { getLogfireApiKey, getLogfireEnabled } from "./secure-storage";
import { log } from "./logger";

type NativeTracingModule = {
  initializeLogfireTracing(serviceName: string, apiKey: string): Promise<void>;
  logfireEvent(tracerName: string, spanName: string, attributes?: Record<string, unknown>): void;
};

const SERVICE_NAME = "vibemachine";
const TRACER_NAME = "vibemachine-tracer";
const LOGFIRE_ENDPOINT = "https://logfire-us.pydantic.dev/v1/traces";

const resolveNativeModule = (): NativeTracingModule | undefined => {
  if (Platform.OS !== "ios") {
    return undefined;
  }

  const candidate = VmWebrtcModule as Partial<NativeTracingModule> | undefined;
  if (
    candidate &&
    typeof candidate.initializeLogfireTracing === "function" &&
    typeof candidate.logfireEvent === "function"
  ) {
    return candidate as NativeTracingModule;
  }

  return undefined;
};

const nativeTracingModule = resolveNativeModule();

let tracer: Tracer | null = null;
let isInitialized = false;
let usingNativeTracing = false;

async function initializeNativeTracer(apiKey: string): Promise<void> {
  if (!nativeTracingModule) {
    throw new Error("Native Logfire module unavailable");
  }

  await nativeTracingModule.initializeLogfireTracing(SERVICE_NAME, apiKey);
  usingNativeTracing = true;
  tracer = null;
}

function initializeJsTracer(apiKey: string): void {
  const exporter = new OTLPTraceExporter({
    url: LOGFIRE_ENDPOINT,
    headers: {
      Authorization: apiKey,
    },
  });

  const provider = new BasicTracerProvider({
    resource: {
      attributes: {
        "service.name": SERVICE_NAME,
      },
    } as any,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  trace.setGlobalTracerProvider(provider);
  tracer = trace.getTracer(TRACER_NAME);
  usingNativeTracing = false;
}

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

    if (nativeTracingModule) {
      try {
        await initializeNativeTracer(apiKey);
        log.info("✅ Logfire native tracing initialized", { emit2logfire: false });
      } catch (nativeError) {
        log.error(
          "Native Logfire initialization failed, falling back to JS exporter",
          { emit2logfire: false },
          nativeError,
        );
        initializeJsTracer(apiKey);
        log.info("✅ Logfire JS tracing fallback initialized", { emit2logfire: false });
      }
    } else {
      initializeJsTracer(apiKey);
      log.info("✅ Logfire JS tracing initialized", { emit2logfire: false });
    }

    isInitialized = true;
  } catch (error) {
    log.error("Failed to initialize Logfire tracing:", { emit2logfire: false }, error);
  }
}

export function logfireEvent(name: string, attrs?: Record<string, unknown>): void {
  if (!isInitialized) {
    log.debug("Logfire tracing not initialized, skipping event:", { emit2logfire: false }, name);
    return;
  }

  if (usingNativeTracing) {
    try {
      nativeTracingModule?.logfireEvent(TRACER_NAME, name, attrs);
    } catch (error) {
      log.error("Failed to log event to Logfire (native path):", { emit2logfire: false }, error);
    }
    return;
  }

  if (!tracer) {
    log.debug("JS tracer not configured, skipping event:", { emit2logfire: false }, name);
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

export function isLogfireInitialized(): boolean {
  return isInitialized;
}
