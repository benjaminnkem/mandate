import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

const tracer = trace.getTracer("mandate");

/**
 * Run `work` inside a span. This uses only the OpenTelemetry API, so it costs nothing until an SDK/exporter is
 * registered by the deployment (for example `node --import @opentelemetry/auto-instrumentations-node/register`).
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
