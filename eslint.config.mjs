import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // next/core-web-vitals only switches on a handful of jsx-a11y checks
  // (alt-text, aria-* validity, role requirements). The full recommended set
  // adds the interaction and labelling rules the components actually need
  // (label-has-associated-control, click-events-have-key-events, ...).
  // Rules only: eslint-config-next already registers the "jsx-a11y" plugin and
  // flat config refuses to register the same name twice.
  {
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Labels that group their text in a stacking <span> (the theme radios)
      // put the text at depth 3, which the default depth of 2 reads as "no
      // accessible text".
      "jsx-a11y/label-has-associated-control": ["error", { depth: 3 }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".worktrees/**",
    // Standalone packages have their own toolchain (packages/*/package.json).
    "packages/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
