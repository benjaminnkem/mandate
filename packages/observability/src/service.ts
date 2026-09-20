import type { Logger } from "pino";

import { createLogger } from "./logger.ts";

export interface ServiceContext {
  readonly logger: Logger;
  /** Aborted on SIGINT/SIGTERM. Long-running loops must observe it. */
  readonly signal: AbortSignal;
}

/**
 * Run a long-lived service with uniform lifecycle handling: structured logs,
 * graceful shutdown on SIGINT/SIGTERM, and a non-zero exit on any startup or
 * runtime failure (including invalid environment).
 */
export async function runService(
  name: string,
  main: (context: ServiceContext) => Promise<void>,
): Promise<void> {
  const logger = createLogger({ service: name, level: process.env["LOG_LEVEL"] ?? "info" });
  const controller = new AbortController();
  const shutdown = (reason: string): void => {
    if (controller.signal.aborted) return;
    logger.info({ reason }, "shutdown requested");
    controller.abort();
  };
  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  try {
    await main({ logger, signal: controller.signal });
    logger.info("service stopped");
  } catch (error) {
    logger.fatal({ err: error }, "service failed");
    process.exitCode = 1;
  }
}

/** Resolve when the signal aborts. Keeps a scaffolded service alive until shutdown. */
export function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
  });
}
