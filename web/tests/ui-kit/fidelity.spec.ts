import fs from "node:fs"
import path from "node:path"
import { expect, test } from "@playwright/test"

type Entry = { id: string; type: string; tags?: string[] }

const indexPath = path.resolve(import.meta.dirname, "../../storybook-static/index.json")
const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as { entries: Record<string, Entry> }
// Only the kit's own stories have a baseline; project stories are not part of the fidelity contract.
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story" && entry.id.startsWith("ui-kit-") && entry.tags?.includes("fidelity"),
)

test("fidelity stories are present", () => {
  expect(stories.length).toBeGreaterThan(0)
})

for (const theme of ["light", "dark"] as const) {
  for (const story of stories) {
    test(`${story.id} · ${theme}`, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`)
      await page.locator("#storybook-root > *").first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await expect(page).toHaveScreenshot(`${story.id}--${theme}.png`, { fullPage: true })
    })
  }
}
