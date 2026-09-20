import { nextJsConfig } from "@repo/eslint-config/next-js";

export default [
  ...nextJsConfig,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
];
