import { describe, expect, it } from 'vitest'
import { buildCropMappingJson, gridCell } from '../src/lib/mapping-json'
import { COLORS, sourceRgba } from './fixtures'
import { pixelAt } from '../src/lib/image'

describe('buildCropMappingJson', () => {
  it('方向 6 裁切 [1,0,2,2)：四角与像素网格都指向原图坐标', () => {
    const json = buildCropMappingJson({
      source: sourceRgba(),
      filename: 'shot.jpg',
      mediaType: 'image/jpeg',
      orientation: 6,
      crop: { x: 1, y: 0, width: 2, height: 2 }
    })

    expect(json.source).toEqual({ width: 2, height: 3, filename: 'shot.jpg', mediaType: 'image/jpeg' })
    expect(json.display).toEqual({ width: 3, height: 2 })
    expect(json.crop).toEqual({ x: 1, y: 0, width: 2, height: 2 })

    // inversePoint 方向6: (y, H-x)，H=3
    expect(json.corners.topLeft).toEqual({ x: 0, y: 2 })
    expect(json.corners.topRight).toEqual({ x: 0, y: 0 })
    expect(json.corners.bottomLeft).toEqual({ x: 2, y: 2 })
    expect(json.corners.bottomRight).toEqual({ x: 2, y: 0 })

    // 像素网格：inversePixel 方向6 = (j, H-1-i)，原点 (1,0)->(0,1)
    const g = json.sourcePixelGrid
    expect(g).toMatchObject({
      originX: 0,
      originY: 1,
      colStepX: 0,
      colStepY: -1,
      rowStepX: 1,
      rowStepY: 0,
      width: 2,
      height: 2
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)('方向 %s：网格枚举出的原图颜色与导出像素一致', (o) => {
    const src = sourceRgba()
    // 取一个非满幅、非原点的矩形（在该方向尺寸允许范围内）
    const crop =
      o <= 4
        ? { x: 0, y: 1, width: 2, height: 2 }
        : { x: 1, y: 0, width: 2, height: 2 }
    const json = buildCropMappingJson({
      source: src,
      filename: null,
      mediaType: 'image/png',
      orientation: o,
      crop
    })

    for (let row = 0; row < crop.height; row++) {
      for (let col = 0; col < crop.width; col++) {
        const p = gridCell(json, col, row)
        // 网格坐标必须是合法原图整数像素
        expect(Number.isInteger(p.x)).toBe(true)
        expect(Number.isInteger(p.y)).toBe(true)
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThan(src.width)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThan(src.height)
        // JSON 指向的原图颜色必须非占位有效色（alpha 255）
        expect(pixelAt(src, p.x, p.y)[3]).toBe(COLORS.R[3])
      }
    }
  })

  it('镜像方向（2）列步长 x=-1；方向 6 列沿原图 y-、行沿原图 x+；转置（5）列沿 y+、行沿 x+', () => {
    const j2 = buildCropMappingJson({
      source: sourceRgba(),
      filename: null,
      mediaType: 'image/png',
      orientation: 2,
      crop: { x: 0, y: 0, width: 2, height: 1 }
    })
    expect([j2.sourcePixelGrid.colStepX, j2.sourcePixelGrid.colStepY]).toEqual([-1, 0])
    expect([j2.sourcePixelGrid.rowStepX, j2.sourcePixelGrid.rowStepY]).toEqual([0, 1])

    const j6 = buildCropMappingJson({
      source: sourceRgba(),
      filename: null,
      mediaType: 'image/png',
      orientation: 6,
      crop: { x: 0, y: 0, width: 2, height: 1 }
    })
    // 方向 6：输出列沿原图 y 负方向（转置后上移），输出行沿原图 x 正方向
    expect([j6.sourcePixelGrid.colStepX, j6.sourcePixelGrid.colStepY]).toEqual([0, -1])
    expect([j6.sourcePixelGrid.rowStepX, j6.sourcePixelGrid.rowStepY]).toEqual([1, 0])

    const j5 = buildCropMappingJson({
      source: sourceRgba(),
      filename: null,
      mediaType: 'image/png',
      orientation: 5,
      crop: { x: 0, y: 0, width: 2, height: 1 }
    })
    // 转置：输出列沿原图 y 正方向，输出行沿原图 x 正方向
    expect([j5.sourcePixelGrid.colStepX, j5.sourcePixelGrid.colStepY]).toEqual([0, 1])
    expect([j5.sourcePixelGrid.rowStepX, j5.sourcePixelGrid.rowStepY]).toEqual([1, 0])
  })

  it('四角与像素网格来自同一逆变换：方向 2 左上角格点位于 tl 角向内半像素', () => {
    const json = buildCropMappingJson({
      source: sourceRgba(),
      filename: null,
      mediaType: 'image/png',
      orientation: 2,
      crop: { x: 0, y: 0, width: 1, height: 1 }
    })
    // 方向2: tl 连续角 = (W, 0)，格点像素中心为 (W-1, 0)，与半开约定一致
    expect(json.corners.topLeft).toEqual({ x: 2, y: 0 })
    expect(gridCell(json, 0, 0)).toEqual({ x: 1, y: 0 })
  })
})
