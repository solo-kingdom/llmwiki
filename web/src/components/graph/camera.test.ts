import { describe, expect, it } from "vitest"
import { fitCamera, panCamera, screenToWorld, worldToScreen, zoomCameraAt } from "./camera"

describe("graph camera", () => {
  it("fits a point cloud inside the viewport", () => {
    const camera = fitCamera([{ x: -100, y: -50 }, { x: 100, y: 50 }], 800, 600, 50)
    const first = worldToScreen(camera, { x: -100, y: -50 }, 800, 600)
    const second = worldToScreen(camera, { x: 100, y: 50 }, 800, 600)
    expect(first.x).toBeGreaterThanOrEqual(50)
    expect(second.x).toBeLessThanOrEqual(750)
    expect(first.y).toBeGreaterThanOrEqual(50)
    expect(second.y).toBeLessThanOrEqual(550)
  })

  it("keeps the zoom pivot on the same world point", () => {
    const camera = { centerX: 10, centerY: 20, scale: 1 }
    const pivot = { x: 620, y: 240 }
    const before = screenToWorld(camera, pivot, 1000, 700)
    const zoomed = zoomCameraAt(camera, pivot, 1.5, 1000, 700)
    const after = screenToWorld(zoomed, pivot, 1000, 700)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it("pans in screen coordinates", () => {
    const moved = panCamera({ centerX: 0, centerY: 0, scale: 2 }, { x: 40, y: -20 })
    expect(moved.centerX).toBe(-20)
    expect(moved.centerY).toBe(10)
  })
})
