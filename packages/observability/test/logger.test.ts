import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createLogger } from "../src/index.ts";

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("logger", () => {
  it("tags every line with the service name", () => {
    const { stream, lines } = capture();
    createLogger({ service: "observer", destination: stream }).info("hello");
    expect(lines()[0]).toMatchObject({ service: "observer", msg: "hello" });
  });

  it("redacts secrets and credentials", () => {
    const { stream, lines } = capture();
    const log = createLogger({ service: "api", destination: stream });
    log.info(
      {
        headers: { authorization: "Bearer abc" },
        DATABASE_URL: "postgres://u:p@h/db",
        nested: { apiKey: "k", privateKey: "p" },
      },
      "x",
    );
    const line = JSON.stringify(lines()[0]);
    expect(line).not.toContain("Bearer abc");
    expect(line).not.toContain("postgres://u:p@h/db");
    expect(line).not.toContain('"k"');
    expect(line).toContain("[redacted]");
  });
});
