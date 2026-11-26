import type { Point } from "./layout"

export interface CameraState {
  centerX: number
  centerY: number
  scale: number
}

export const MIN_SCALE = 0.12
export const MAX_SCALE = 5

export function worldToScreen(camera: CameraState, point: Point, width: number, height: number): Point {
  return {
    x: (point.x - camera.centerX) * camera.scale + width / 2,
    y: (point.y - camera.centerY) * camera.scale + height / 2,
  }
}

export function screenToWorld(camera: CameraState, point: Point, width: number, height: number): Point {
  return {
    x: (point.x - width / 2) / camera.scale + camera.centerX,
    y: (point.y - height / 2) / camera.scale + camera.centerY,
  }
}

export function fitCamera(points: Point[], width: number, height: number, padding = 72): CameraState {
  if (points.length === 0) return { centerX: 0, centerY: 0, scale: 1 }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const availableWidth = Math.max(80, width - padding * 2)
  const availableHeight = Math.max(80, height - padding * 2)
  const scale = Math.min(1.35, availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY))
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)),
  }
}

export function zoomCameraAt(
  camera: CameraState,
  pivot: Point,
  factor: number,
  width: number,
  height: number,
): CameraState {
  const worldPivot = screenToWorld(camera, pivot, width, height)
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, camera.scale * factor))
  return {
    centerX: worldPivot.x - (pivot.x - width / 2) / scale,
    centerY: worldPivot.y - (pivot.y - height / 2) / scale,
    scale,
  }
}

export function panCamera(camera: CameraState, delta: Point): CameraState {
  return {
    ...camera,
    centerX: camera.centerX - delta.x / camera.scale,
    centerY: camera.centerY - delta.y / camera.scale,
  }
}

export function easeCamera(camera: CameraState, target: CameraState, elapsedMs: number): { camera: CameraState; settled: boolean } {
  const amount = 1 - Math.exp(-elapsedMs / 110)
  const next = {
    centerX: camera.centerX + (target.centerX - camera.centerX) * amount,
    centerY: camera.centerY + (target.centerY - camera.centerY) * amount,
    scale: camera.scale + (target.scale - camera.scale) * amount,
  }
  const settled = Math.abs(next.centerX - target.centerX) < 0.05
    && Math.abs(next.centerY - target.centerY) < 0.05
    && Math.abs(next.scale - target.scale) < 0.0005
  return { camera: settled ? target : next, settled }
}
