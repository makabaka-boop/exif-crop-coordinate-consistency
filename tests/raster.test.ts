import { describe, expect, it } from 'vitest'
import {
  EXPECTED_ORIENTED_GRIDS,
  H,
  W,
  imgToGrid,
  sourceRgba
} from './fixtures'
import { buildOrientedRgba, cropFromSource, pixelAt } from '../src/lib/image'
import { ORIENTATIONS } from '../src/lib/geometry'

describe('buildOrientedRgba 逐像素构建八种方向', () => {
  it.each(ORIENTATIONS)('方向 %s 的光栅与期望彩色矩阵逐项一致', (o) => {
    const oriented = buildOrientedRgba(sourceRgba(), o)
    const expected = EXPECTED_ORIENTED_GRIDS[o]
    expect(oriented.height).toBe(expected.length)
    expect(oriented.width).toBe(expected[0].length)
    expect(imgToGrid(oriented)).toEqual(expected)
  })

  it('方向 5–8 尺寸交换，且每个像素都来自原图（alpha 不丢）', () => {
    const oriented = buildOrientedRgba(sourceRgba(), 6)
    expect([oriented.width, oriented.height]).toEqual([H, W])
    for (let y = 0; y < oriented.height; y++) {
      for (let x = 0; x < oriented.width; x++) {
        expect(pixelAt(oriented, x, y)[3]).toBe(255)
      }
    }
  })
})

describe('cropFromSource：正向矩形逆变换回原图取样', () => {
  it('方向 1：矩形 [0,0,2,2) 等于原图左上角', () => {
    const out = cropFromSource(sourceRgba(), 1, { x: 0, y: 0, w: 2, h: 2 })
    expect(imgToGrid(out)).toEqual([
      ['R', 'B'],
      ['G', 'C']
    ])
  })

  it('方向 6：正向矩形 [0,0,2,2) 按 (j, H-1-i) 取样 = W,G / K,C', () => {
    const out = cropFromSource(sourceRgba(), 6, { x: 0, y: 0, w: 2, h: 2 })
    expect(pixelAt(out, 0, 0)).toEqual([255, 255, 255, 255]) // W
    expect(pixelAt(out, 1, 0)).toEqual([0, 255, 0, 255]) // G
    expect(pixelAt(out, 0, 1)).toEqual([0, 0, 0, 255]) // K
    expect(pixelAt(out, 1, 1)).toEqual([0, 255, 255, 255]) // C
    expect(imgToGrid(out)).toEqual([
      ['W', 'G'],
      ['K', 'C']
    ])
  })

  it('方向 2（水平镜像）：正向矩形 [0,0,1,1) 取到原图右上的蓝，证明没截错角', () => {
    const out = cropFromSource(sourceRgba(), 2, { x: 0, y: 0, w: 1, h: 1 })
    expect(imgToGrid(out)).toEqual([['B']])
  })

  it('方向 7（副对角线镜像）：正向左上角对应原图右下角的黑', () => {
    const out = cropFromSource(sourceRgba(), 7, { x: 0, y: 0, w: 1, h: 1 })
    expect(imgToGrid(out)).toEqual([['K']])
  })

  it('方向 5 全幅裁切等于整幅正向画面，且与 buildOrientedRgba 逐像素一致', () => {
    const oriented = buildOrientedRgba(sourceRgba(), 5)
    const out = cropFromSource(sourceRgba(), 5, {
      x: 0,
      y: 0,
      w: oriented.width,
      h: oriented.height
    })
    expect(Array.from(out.data)).toEqual(Array.from(oriented.data))
  })

  it.each(ORIENTATIONS)('方向 %s：任意合法矩形输出与正向预览对应区域逐像素相同', (o) => {
    const src = sourceRgba()
    const oriented = buildOrientedRgba(src, o)
    const rect = { x: 0, y: 0, w: oriented.width, h: oriented.height }
    const out = cropFromSource(src, o, rect)
    expect(Array.from(out.data)).toEqual(Array.from(oriented.data))
  })

  it('拒绝越界与非正尺寸', () => {
    expect(() => cropFromSource(sourceRgba(), 1, { x: -1, y: 0, w: 1, h: 1 })).toThrow(
      RangeError
    )
    expect(() => cropFromSource(sourceRgba(), 1, { x: 0, y: 0, w: 0, h: 1 })).toThrow(
      RangeError
    )
    expect(() => cropFromSource(sourceRgba(), 1, { x: 1, y: 0, w: 2, h: 1 })).toThrow(
      RangeError
    )
    // 方向 6 正向画面宽为 3，按正向尺寸越界也要拒绝
    expect(() => cropFromSource(sourceRgba(), 6, { x: 2, y: 0, w: 2, h: 1 })).toThrow(
      RangeError
    )
  })
})
