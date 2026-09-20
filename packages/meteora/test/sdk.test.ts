import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DLMM, METEORA_DLMM_SDK_VERSION, meteoraSdk } from "../src/index.ts";

describe("Meteora SDK loading", () => {
  it("loads the DLMM class from the official SDK", () => {
    expect(typeof DLMM.create).toBe("function");
    expect(typeof meteoraSdk.LBCLMM_PROGRAM_IDS).toBe("object");
  });

  it("keeps the recorded SDK version equal to the pinned dependency", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@meteora-ag/dlmm"]).toBe(METEORA_DLMM_SDK_VERSION);
  });

  it("knows the official mainnet DLMM program id", () => {
    expect(Object.values(meteoraSdk.LBCLMM_PROGRAM_IDS).map(String)).toContain(
      "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
    );
  });
});
