import { describe, expect, it } from 'vitest'
import {
  ORIENTATIONS,
  forwardPixel,
  forwardPoint,
  inversePixel,
  inversePoint,
  inverseRectCorners,
  orientedSize,
  type Point
} from '../src/lib/geometry'

const W = 5
const H = 3

describe('orientedSize', () => {
  it('方向 1–4 不交换宽高，5–8 交换宽高', () => {
    for (const o of ORIENTATIONS) {
      const s = orientedSize(W, H, o)
      if (o <= 4) expect(s).toEqual({ width: W, height: H })
      else expect(s).toEqual({ width: H, height: W })
    }
  })
})

describe('像素正/逆映射对每种方向构成双射', () => {
  it.each(ORIENTATIONS)('方向 %s：forward∘inverse 与 inverse∘forward 都是恒等', (o) => {
    const { width: dw, height: dh } = orientedSize(W, H, o)

    // 目标域每个像素逆变换后落在原图整数范围内，再正变换回到自身
    for (let i = 0; i < dw; i++) {
      for (let j = 0; j < dh; j++) {
        const s = inversePixel(i, j, W, H, o)
        expect(s.x).toBeGreaterThanOrEqual(0)
        expect(s.x).toBeLessThan(W)
        expect(s.y).toBeGreaterThanOrEqual(0)
        expect(s.y).toBeLessThan(H)
        expect(Number.isInteger(s.x)).toBe(true)
        expect(Number.isInteger(s.y)).toBe(true)
        expect(forwardPixel(s.x, s.y, W, H, o)).toEqual({ x: i, y: j })
      }
    }

    // 原图每个像素正变换后也能被逆变换还原
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const d = forwardPixel(x, y, W, H, o)
        expect(d.x).toBeGreaterThanOrEqual(0)
        expect(d.x).toBeLessThan(dw)
        expect(d.y).toBeGreaterThanOrEqual(0)
        expect(d.y).toBeLessThan(dh)
        expect(inversePixel(d.x, d.y, W, H, o)).toEqual({ x, y })
      }
    }
  })

  it('逆映射覆盖目标域全部像素且无重复（无插值/无空洞）', () => {
    for (const o of ORIENTATIONS) {
      const { width: dw, height: dh } = orientedSize(W, H, o)
      const seen = new Set<string>()
      for (let i = 0; i < dw; i++) {
        for (let j = 0; j < dh; j++) {
          const s = inversePixel(i, j, W, H, o)
          const key = `${s.x},${s.y}`
          expect(seen.has(key)).toBe(false)
          seen.add(key)
        }
      }
      expect(seen.size).toBe(W * H)
    }
  })
})

describe('连续坐标映射把半开 [0,W)×[0,H) 映射到半开区域', () => {
  it.each(ORIENTATIONS)('方向 %s：四个边界角映射到边界角', (o) => {
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: 0, y: H },
      { x: W, y: H }
    ]
    for (const p of corners) {
      const f = forwardPoint(p, W, H, o)
      const back = inversePoint(f, W, H, o)
      expect(back.x).toBeCloseTo(p.x, 10)
      expect(back.y).toBeCloseTo(p.y, 10)
    }
  })

  it.each(ORIENTATIONS)('方向 %s：内部任意点正逆互逆', (o) => {
    const samples: Point[] = [
      { x: 0.3, y: 0.7 },
      { x: 2.5, y: 1.5 },
      { x: 4.99, y: 2.01 }
    ]
    for (const p of samples) {
      const f = forwardPoint(p, W, H, o)
      const back = inversePoint(f, W, H, o)
      expect(back.x).toBeCloseTo(p.x, 10)
      expect(back.y).toBeCloseTo(p.y, 10)
    }
  })
})

describe('镜像方向必须反映镜像而非纯旋转', () => {
  it('方向 2（水平镜像）：左上像素来自原图右上，且 x 顺序翻转', () => {
    expect(inversePixel(0, 0, W, H, 2)).toEqual({ x: W - 1, y: 0 })
    expect(inversePixel(1, 0, W, H, 2)).toEqual({ x: W - 2, y: 0 })
  })

  it('方向 5（转置）：是镜像，与 90° 旋转明显不同', () => {
    // 转置保持左上不动；6（CW90）把原图右上送到正向上边缘最右
    expect(forwardPixel(0, 0, W, H, 5)).toEqual({ x: 0, y: 0 })
    expect(forwardPixel(W - 1, 0, W, H, 5)).toEqual({ x: 0, y: W - 1 })
    expect(forwardPixel(W - 1, 0, W, H, 6)).toEqual({ x: H - 1, y: W - 1 })
  })

  it('方向 7（副对角线镜像）：左上像素来自原图右下', () => {
    expect(inversePixel(0, 0, W, H, 7)).toEqual({ x: W - 1, y: H - 1 })
  })

  it('方向 6（CW90 纯旋转，无镜像）：正向左上来自原图左下', () => {
    expect(inversePixel(0, 0, W, H, 6)).toEqual({ x: 0, y: H - 1 })
  })
})

describe('inverseRectCorners 对镜像方向逐角映射（不能只算两角）', () => {
  it('方向 2：正向左上的原图像在右上，正向右上的原图在左上', () => {
    const r = { x: 1, y: 1, w: 2, h: 1 }
    const poly = inverseRectCorners(r, W, H, 2)
    expect(poly.tl).toEqual({ x: W - 1, y: 1 })
    expect(poly.tr).toEqual({ x: W - 3, y: 1 })
    expect(poly.bl).toEqual({ x: W - 1, y: 2 })
    expect(poly.br).toEqual({ x: W - 3, y: 2 })
  })

  it('方向 6：连续角点使用 n-c 反射轴，四角位置各不相同', () => {
    const r = { x: 0, y: 0, w: 2, h: 2 }
    const poly = inverseRectCorners(r, W, H, 6)
    // inversePoint 方向6: (y, H-x)
    expect(poly.tl).toEqual({ x: 0, y: H })
    expect(poly.tr).toEqual({ x: 0, y: H - 2 })
    expect(poly.bl).toEqual({ x: 2, y: H })
    expect(poly.br).toEqual({ x: 2, y: H - 2 })
  })
})
