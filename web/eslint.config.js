import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"
import uiTemplate from "./eslint/ui-template.mjs"

// Kit-owned files (ui-template.lock.json): checked upstream, never edited here.
const kit = [
  "src/components/ui/**", "src/components/blocks/**", "src/components/page-templates/**", "src/hooks/**",
  "src/stories/ui-kit/**", "src/lib/utils.ts", "src/lib/vocab.ts", ".storybook/**", "tests/ui-kit/**",
  "playwright.fidelity.config.ts", "eslint/**",
]

export default [
  { ignores: ["dist", "storybook-static", ".ui-kit", "test-results", "playwright-report", ...kit] },
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: reactHooks.configs.recommended.rules },
  { files: ["src/**/*.tsx"], plugins: { "ui-template": uiTemplate }, rules: uiTemplate.configs.recommended.rules },
]
