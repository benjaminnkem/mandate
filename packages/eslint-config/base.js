import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/**
 * Shared strict ESLint configuration. Errors stay errors: there is deliberately
 * no "only-warn" downgrade, because this is settlement-critical code.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = tseslint.config(
  { ignores: ["dist/**", ".next/**", "coverage/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Money math must be integer-safe: never let a Number stand in for a bigint amount.
      "no-restricted-globals": [
        "error",
        { name: "parseFloat", message: "Use bigint/integer parsing for amounts." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Number",
          property: "parseFloat",
          message: "Use bigint/integer parsing for amounts.",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  eslintConfigPrettier,
);
