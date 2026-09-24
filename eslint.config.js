import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/.wrangler/**", "packages/worker/public/vendor/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
  },
  {
    files: ["packages/worker/src/**/*.js", "packages/worker/test/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["packages/worker/public/**/*.js", "packages/client/src/app/renderer/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
];
