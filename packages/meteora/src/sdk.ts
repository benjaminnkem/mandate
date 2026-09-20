import { createRequire } from "node:module";

import type * as MeteoraSdk from "@meteora-ag/dlmm";

/**
 * The exact SDK version this package is pinned to. Every evidence bundle records it.
 * A test asserts it equals the version pinned in package.json.
 */
export const METEORA_DLMM_SDK_VERSION = "1.9.14";

/** The shape the SDK's bundled type declarations give to `require("@meteora-ag/dlmm")`. */
type SdkExports = typeof MeteoraSdk.default;

/**
 * Load the official Meteora DLMM SDK through its CommonJS build.
 *
 * The SDK's ESM entry (`dist/index.mjs`) cannot be loaded by native Node ESM: it
 * performs a directory import into `@coral-xyz/anchor/dist/cjs/utils/bytes`
 * (ERR_UNSUPPORTED_DIR_IMPORT). Its CJS build works.
 *
 * Quirk, verified at runtime: in the CJS build `module.exports` IS the `DLMM` class,
 * with every other export attached as a property (`require(...).create`,
 * `require(...).LBCLMM_PROGRAM_IDS`). The bundled type declarations instead describe
 * a module object with a `default` member, which does not exist at runtime. We
 * therefore type the module as declared (for its named exports) and expose the class
 * through an explicit cast. See docs/adr/0005-meteora-sdk-loading.md.
 */
const sdkExports = createRequire(import.meta.url)("@meteora-ag/dlmm") as SdkExports;

/** The official `DLMM` class. */
export const DLMM = sdkExports as unknown as SdkExports["default"];
export type DLMMInstance = InstanceType<typeof DLMM>;

/** All other named SDK exports (constants, helpers, types). */
export const meteoraSdk: Omit<SdkExports, "default"> = sdkExports;
