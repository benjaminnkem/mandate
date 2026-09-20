import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
];
