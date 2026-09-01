'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { FP_PADDING, clamp, computeScale, openingLine } from '@/lib/floorplan'
import { useThemeColors } from './useThemeColors'
import type { Opening } from '@/lib/types'

export type Box = {
  placementId: string
  itemId: string
  name: string
  widthIn: number
  depthIn: number
  x: number
  y: number
  rotation: number
}

type Props = {
  roomWidthIn: number
  roomDepthIn: number
  doors: Opening[]
  windows: Opening[]
  boxes: Box[]
  canEdit: boolean
  selectedId: string | null
  onSelect: (placementId: string | null) => void
  onMove: (placementId: string, xIn: number, yIn: number) => void
}

// Hex + "AA" alpha suffix (Konva accepts #rrggbbaa).
const withAlpha = (hex: string, alpha: string) =>
  /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex

export function FloorPlanCanvas({
  roomWidthIn,
  roomDepthIn,
  doors,
  windows,
  boxes,
  canEdit,
  selectedId,
  onSelect,
  onMove,
}: Props) {
  const colors = useThemeColors()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = useMemo(
    () => (width > 0 ? computeScale(width, roomWidthIn, roomDepthIn) : 0),
    [width, roomWidthIn, roomDepthIn]
  )

  const roomWpx = roomWidthIn * scale
  const roomDpx = roomDepthIn * scale
  const stageHeight = roomDpx + FP_PADDING * 2

  function handleDragEnd(box: Box, node: Konva.Node) {
    const xIn = clamp((node.x() - FP_PADDING) / scale, 0, roomWidthIn)
    const yIn = clamp((node.y() - FP_PADDING) / scale, 0, roomDepthIn)
    onMove(box.placementId, Math.round(xIn * 100) / 100, Math.round(yIn * 100) / 100)
  }

  return (
    <div ref={wrapRef} className="mm-floorplan__canvas">
      {scale > 0 && (
        <Stage
          width={width}
          height={stageHeight}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage()) onSelect(null)
          }}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage()) onSelect(null)
          }}
        >
          <Layer>
            {/* room outline */}
            <Rect
              x={FP_PADDING}
              y={FP_PADDING}
              width={roomWpx}
              height={roomDpx}
              fill={colors['--bg-secondary']}
              stroke={colors['--text-primary']}
              strokeWidth={2}
            />

            {/* windows (thin, info color) */}
            {windows.map((w, i) => (
              <Line
                key={`win-${i}`}
                points={openingLine(w, roomWidthIn, roomDepthIn, scale).points}
                stroke={colors['--info-text']}
                strokeWidth={4}
                dash={[6, 3]}
              />
            ))}

            {/* doors (thick, accent color) */}
            {doors.map((d, i) => (
              <Line
                key={`door-${i}`}
                points={openingLine(d, roomWidthIn, roomDepthIn, scale).points}
                stroke={colors['--accent-product']}
                strokeWidth={6}
                lineCap="round"
              />
            ))}

            {/* item boxes */}
            {boxes.map((box) => {
              const w = box.widthIn * scale
              const h = box.depthIn * scale
              const selected = box.placementId === selectedId
              return (
                <Group
                  key={box.placementId}
                  x={FP_PADDING + box.x * scale}
                  y={FP_PADDING + box.y * scale}
                  rotation={box.rotation}
                  draggable={canEdit}
                  onClick={() => onSelect(box.placementId)}
                  onTap={() => onSelect(box.placementId)}
                  dragBoundFunc={(pos) => ({
                    x: clamp(pos.x, FP_PADDING, FP_PADDING + roomWpx),
                    y: clamp(pos.y, FP_PADDING, FP_PADDING + roomDpx),
                  })}
                  onDragEnd={(e) => handleDragEnd(box, e.target)}
                >
                  <Rect
                    width={w}
                    height={h}
                    fill={withAlpha(colors['--accent-product'], '33')}
                    stroke={
                      selected ? colors['--text-primary'] : colors['--accent-product']
                    }
                    strokeWidth={selected ? 2.5 : 1.5}
                  />
                  <Text
                    text={box.name}
                    x={4}
                    y={4}
                    width={Math.max(w - 8, 8)}
                    fontSize={11}
                    fill={colors['--text-primary']}
                    ellipsis
                    listening={false}
                  />
                </Group>
              )
            })}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
