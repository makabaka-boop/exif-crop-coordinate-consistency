import {
  inversePixel,
  orientedSize,
  type Orientation,
  type Rect
} from './geometry'

/**
 * RGBA 光栅。data 长度必须为 width * height * 4，逐行排列，
 * 与 ImageData 的内存布局一致，可零拷贝互换。
 */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export function makeRgba(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

/**
 * 按 EXIF 方向构建正向画面光栅：对每个原图像素做正向映射放置，
 * 每个目标像素恰好被写一次，纯拷贝、无插值、无缩放。
 */
export function buildOrientedRgba(src: RgbaImage, orientation: Orientation): RgbaImage {
  const { width: W, height: H } = src
  const { width: dw, height: dh } = orientedSize(W, H, orientation)
  const dst = makeRgba(dw, dh)

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const di = orientation
      // 逐像素正向：保持与几何模块同一套表
      let dx = 0
      let dy = 0
      switch (di) {
        case 1: dx = sx; dy = sy; break
        case 2: dx = W - 1 - sx; dy = sy; break
        case 3: dx = W - 1 - sx; dy = H - 1 - sy; break
        case 4: dx = sx; dy = H - 1 - sy; break
        case 5: dx = sy; dy = sx; break
        case 6: dx = H - 1 - sy; dy = sx; break
        case 7: dx = H - 1 - sy; dy = W - 1 - sx; break
        case 8: dx = sy; dy = W - 1 - sx; break
      }
      const sOff = (sy * W + sx) * 4
      const dOff = (dy * dw + dx) * 4
      dst.data[dOff] = src.data[sOff]
      dst.data[dOff + 1] = src.data[sOff + 1]
      dst.data[dOff + 2] = src.data[sOff + 2]
      dst.data[dOff + 3] = src.data[sOff + 3]
    }
  }
  return dst
}

/**
 * 在正向画面坐标系中给定半开整数矩形，从原图直接取样导出。
 * 输出像素 (i,j) 来自原图 inversePixel(x+i, y+j)，
 * 因此导出文件与正向预览所见像素严格一致，且为原始像素、无缩放。
 */
export function cropFromSource(
  src: RgbaImage,
  orientation: Orientation,
  rect: Rect
): RgbaImage {
  const { width: W, height: H } = src
  const { width: dw, height: dh } = orientedSize(W, H, orientation)
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const w = Math.round(rect.w)
  const h = Math.round(rect.h)

  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > dw || y + h > dh) {
    throw new RangeError('裁切矩形越界或尺寸非正')
  }

  const out = makeRgba(w, h)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = inversePixel(x + i, y + j, W, H, orientation)
      const sOff = (s.y * W + s.x) * 4
      const dOff = (j * w + i) * 4
      out.data[dOff] = src.data[sOff]
      out.data[dOff + 1] = src.data[sOff + 1]
      out.data[dOff + 2] = src.data[sOff + 2]
      out.data[dOff + 3] = src.data[sOff + 3]
    }
  }
  return out
}

/** 读取单个像素（测试用）。 */
export function pixelAt(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const off = (y * img.width + x) * 4
  return [img.data[off], img.data[off + 1], img.data[off + 2], img.data[off + 3]]
}

export function imageDataToRgba(img: ImageData): RgbaImage {
  return { width: img.width, height: img.height, data: img.data }
}

export function toImageData(img: RgbaImage): ImageData {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)
}

/**
 * 把任意指针坐标规整为整像素半开矩形：
 * 起点/终点各吸附到最近整数像素边界，再规范化。
 * 返回的矩形始终满足 x<=x2, y<=y2。
 */
export function snapDragRect(
  start: { x: number; y: number },
  end: { x: number; y: number }
): Rect {
  const x1 = Math.round(start.x)
  const y1 = Math.round(start.y)
  const x2 = Math.round(end.x)
  const y2 = Math.round(end.y)
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1)
  }
}

export interface RectCheck {
  valid: boolean
  reason?: string
}

/**
 * 校验整像素半开矩形是否落在正向画面内且尺寸至少 1×1。
 * 非法矩形不会导出，调用方负责保留当前图片但禁用下载。
 */
export function checkCropRect(rect: Rect, displayW: number, displayH: number): RectCheck {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isInteger)) {
    return { valid: false, reason: '边界必须为整像素' }
  }
  if (rect.w < 1 || rect.h < 1) {
    return { valid: false, reason: '裁切区域至少为 1×1 像素' }
  }
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > displayW || rect.y + rect.h > displayH) {
    return { valid: false, reason: '裁切区域超出图片边界' }
  }
  return { valid: true }
}
