/**
 * Fidelity check: every story tagged "fidelity" is rendered in light and dark and compared pixel for pixel with a
 * baseline rendered from the pristine template with this project's theme (verify_fidelity.py builds it).
 */
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

const baseline = path.resolve(process.env["UI_KIT_BASELINE"] ?? ".ui-kit/baseline")

export default defineConfig({
  testDir: "tests/ui-kit",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  snapshotPathTemplate: `${baseline}/{arg}{ext}`,
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled", caret: "hide" } },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:6007",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: "npx vite preview --outDir storybook-static --port 6007 --strictPort",
    url: "http://127.0.0.1:6007/iframe.html",
    reuseExistingServer: false,
  },
})
