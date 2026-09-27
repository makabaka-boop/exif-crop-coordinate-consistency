import {
  inversePixel,
  inverseRectCorners,
  orientedSize,
  type Orientation,
  type Point
} from './geometry'
import type { RgbaImage } from './image'

export interface CropMappingJson {
  version: 1
  source: {
    width: number
    height: number
    filename: string | null
    mediaType: string
  }
  orientation: Orientation
  display: {
    width: number
    height: number
  }
  crop: {
    x: number
    y: number
    width: number
    height: number
  }
  /** 半开矩形四个几何角逆变换到原图连续平面的坐标。 */
  corners: {
    topLeft: Point
    topRight: Point
    bottomLeft: Point
    bottomRight: Point
  }
  /**
   * 导出网格在原图中的像素坐标。输出像素 (col,row) 对应原图：
   *   x = originX + col * colStepX + row * rowStepX
   *   y = originY + col * colStepY + row * rowStepY
   * 每个步长分量为 -1/0/1；转置方向（5–8）下输出列沿原图 y 轴移动，
   * 因此必须用二维步长，不能假设 col 恒对应 x。
   */
  sourcePixelGrid: {
    originX: number
    originY: number
    colStepX: -1 | 0 | 1
    colStepY: -1 | 0 | 1
    rowStepX: -1 | 0 | 1
    rowStepY: -1 | 0 | 1
    width: number
    height: number
  }
  coordinateSystem: string
}

export const COORDINATE_SYSTEM =
  'continuous-half-open: corners use original-image plane coordinates in pixels, half-open [x,x+w) x [y,y+h)'

/**
 * 生成包含原图坐标的映射 JSON。
 * 矩形四角与像素网格来自同一套逆变换，保证 JSON 与导出 PNG 严格同源。
 */
export function buildCropMappingJson(params: {
  source: RgbaImage
  filename: string | null
  mediaType: string
  orientation: Orientation
  crop: { x: number; y: number; width: number; height: number }
}): CropMappingJson {
  const { source, filename, mediaType, orientation, crop } = params
  const size = orientedSize(source.width, source.height, orientation)
  const poly = inverseRectCorners(
    { x: crop.x, y: crop.y, w: crop.width, h: crop.height },
    source.width,
    source.height,
    orientation
  )

  // 网格步长直接由 inversePixel 的一阶差分得到：
  // 输出列/行各自在原图平面上的位移，镜像方向自然为 -1，转置方向天然换轴。
  const origin = inversePixel(crop.x, crop.y, source.width, source.height, orientation)
  const nextCol = inversePixel(crop.x + 1, crop.y, source.width, source.height, orientation)
  const nextRow = inversePixel(crop.x, crop.y + 1, source.width, source.height, orientation)

  return {
    version: 1,
    source: {
      width: source.width,
      height: source.height,
      filename,
      mediaType
    },
    orientation,
    display: { width: size.width, height: size.height },
    crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    corners: {
      topLeft: poly.tl,
      topRight: poly.tr,
      bottomLeft: poly.bl,
      bottomRight: poly.br
    },
    sourcePixelGrid: {
      originX: origin.x,
      originY: origin.y,
      colStepX: (nextCol.x - origin.x) as -1 | 0 | 1,
      colStepY: (nextCol.y - origin.y) as -1 | 0 | 1,
      rowStepX: (nextRow.x - origin.x) as -1 | 0 | 1,
      rowStepY: (nextRow.y - origin.y) as -1 | 0 | 1,
      width: crop.width,
      height: crop.height
    },
    coordinateSystem: COORDINATE_SYSTEM
  }
}

/** 按 JSON 网格枚举第 (col,row) 个输出像素对应的原图像素坐标。 */
export function gridCell(json: CropMappingJson, col: number, row: number): Point {
  const g = json.sourcePixelGrid
  return {
    x: g.originX + col * g.colStepX + row * g.rowStepX,
    y: g.originY + col * g.colStepY + row * g.rowStepY
  }
}
