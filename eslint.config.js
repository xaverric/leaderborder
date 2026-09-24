import js from "@eslint/js";
import security from "eslint-plugin-security";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/.wrangler/**", "packages/worker/public/vendor/**"] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: {
      "security/detect-object-injection": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  {
    files: ["packages/worker/src/**/*.js", "packages/worker/test/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["packages/worker/public/**/*.js", "packages/client/src/app/renderer/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/test/**/*.js", "scripts/*.test.js"],
    rules: { "security/detect-unsafe-regex": "off", "security/detect-non-literal-regexp": "off", "security/detect-child-process": "off" },
  },
];
