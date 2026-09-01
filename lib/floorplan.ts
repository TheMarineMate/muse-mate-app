import type { Opening, Wall } from './types'

export const FP_PADDING = 24
export const FP_MAX_HEIGHT = 480

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** px per inch that fits a room of roomW x roomD inches into the given box. */
export function computeScale(
  containerWidth: number,
  roomWidthIn: number,
  roomDepthIn: number
): number {
  const availW = Math.max(1, containerWidth - FP_PADDING * 2)
  const availH = Math.max(1, FP_MAX_HEIGHT - FP_PADDING * 2)
  if (roomWidthIn <= 0 || roomDepthIn <= 0) return 1
  return Math.min(availW / roomWidthIn, availH / roomDepthIn)
}

/** Endpoints (stage px) of an opening drawn along its wall. */
export function openingLine(
  opening: Opening,
  roomWidthIn: number,
  roomDepthIn: number,
  scale: number
): { points: [number, number, number, number] } {
  const p = FP_PADDING
  const roomWpx = roomWidthIn * scale
  const roomDpx = roomDepthIn * scale
  const start = opening.offset * scale
  const end = (opening.offset + opening.width) * scale

  const byWall: Record<Wall, [number, number, number, number]> = {
    N: [p + start, p, p + end, p],
    S: [p + start, p + roomDpx, p + end, p + roomDpx],
    W: [p, p + start, p, p + end],
    E: [p + roomWpx, p + start, p + roomWpx, p + end],
  }
  return { points: byWall[opening.wall] }
}

export const WALL_OPTIONS: { value: Wall; label: string }[] = [
  { value: 'N', label: 'North (top)' },
  { value: 'E', label: 'East (right)' },
  { value: 'S', label: 'South (bottom)' },
  { value: 'W', label: 'West (left)' },
]
