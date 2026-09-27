/**
 * EXIF orientation 1–8 的纯函数几何映射。
 *
 * 关键：方向 2/4/5/7 含镜像，不能用单纯旋转处理。
 *
 * 提供两套映射：
 * - forwardPixel / inversePixel：像素索引映射，反射轴为 `n - 1 - c`，
 *   因此像素在原图与正向预览之间一一对应，无需插值。
 * - forwardPoint / inversePoint：连续坐标映射，反射轴为 `n - c`，
 *   用于半开矩形 [x, x+w) × [y, y+h) 的几何角点。
 *
 * 正向表示「原图 (x,y) 出现在正向画面的什么位置」；
 * 逆变换表示「正向画面 (x,y) 来自原图的什么位置」。
 */

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const ORIENTATIONS: readonly Orientation[] = [1, 2, 3, 4, 5, 6, 7, 8]

export interface Point {
  x: number
  y: number
}

export function isOrientation(value: number): value is Orientation {
  return Number.isInteger(value) && value >= 1 && value <= 8
}

/** EXIF 方向对应正向画面（预览/导出）的宽高。 */
export function orientedSize(
  sourceW: number,
  sourceH: number,
  orientation: Orientation
): { width: number; height: number } {
  const swapped = orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8
  return swapped
    ? { width: sourceH, height: sourceW }
    : { width: sourceW, height: sourceH }
}

interface Affine {
  a: -1 | 0 | 1
  b: -1 | 0 | 1
  c: -1 | 0 | 1
  d: -1 | 0 | 1
  /** x' = a*x + b*y + ox（像素版本 ox 直接查表） */
  ox: number
  oy: number
}

/**
 * 正向像素映射的系数表，键为方向。
 * 反射项的偏移使用 (n - 1) 形式；旋转项使用 n 形式。
 * 用函数形式返回以便带入源宽高 W/H。
 */
function forwardPixelAffine(o: Orientation, W: number, H: number): Affine {
  switch (o) {
    case 1:
      return { a: 1, b: 0, c: 0, d: 1, ox: 0, oy: 0 }
    case 2:
      return { a: -1, b: 0, c: 0, d: 1, ox: W - 1, oy: 0 }
    case 3:
      return { a: -1, b: 0, c: 0, d: -1, ox: W - 1, oy: H - 1 }
    case 4:
      return { a: 1, b: 0, c: 0, d: -1, ox: 0, oy: H - 1 }
    case 5:
      // 转置（关于主对角线镜像）
      return { a: 0, b: 1, c: 1, d: 0, ox: 0, oy: 0 }
    case 6:
      // 顺时针 90°：(x,y) -> (H-1-y, x)
      return { a: 0, b: -1, c: 1, d: 0, ox: H - 1, oy: 0 }
    case 7:
      // 横向翻转（关于副对角线镜像）：(x,y) -> (H-1-y, W-1-x)
      return { a: 0, b: -1, c: -1, d: 0, ox: H - 1, oy: W - 1 }
    case 8:
      // 逆时针 90°：(x,y) -> (y, W-1-x)
      return { a: 0, b: 1, c: -1, d: 0, ox: 0, oy: W - 1 }
  }
}

function applyAffine(m: Affine, x: number, y: number): Point {
  return { x: m.a * x + m.b * y + m.ox, y: m.c * x + m.d * y + m.oy }
}

function forwardPixelPoint(p: Point, W: number, H: number, o: Orientation): Point {
  return applyAffine(forwardPixelAffine(o, W, H), p.x, p.y)
}

/** 正向像素映射：原图像素 (x,y) -> 正向画面像素。 */
export function forwardPixel(
  x: number,
  y: number,
  sourceW: number,
  sourceH: number,
  orientation: Orientation
): Point {
  return forwardPixelPoint({ x, y }, sourceW, sourceH, orientation)
}

/**
 * 连续坐标的正向映射。与像素版的唯一区别是反射项用 n 而非 n-1，
 * 这样 [0,n) 整个半开区间恰好映射到 [0,n)。
 */
export function forwardPoint(p: Point, W: number, H: number, o: Orientation): Point {
  return continuousForward(p, W, H, o)
}

function continuousForward(p: Point, W: number, H: number, o: Orientation): Point {
  const { x, y } = p
  switch (o) {
    case 1:
      return { x, y }
    case 2:
      return { x: W - x, y }
    case 3:
      return { x: W - x, y: H - y }
    case 4:
      return { x, y: H - y }
    case 5:
      return { x: y, y: x }
    case 6:
      return { x: H - y, y: x }
    case 7:
      return { x: H - y, y: W - x }
    case 8:
      return { x: y, y: W - x }
  }
}

function continuousInverse(p: Point, W: number, H: number, o: Orientation): Point {
  const { x, y } = p
  switch (o) {
    case 1:
      return { x, y }
    case 2:
      return { x: W - x, y }
    case 3:
      return { x: W - x, y: H - y }
    case 4:
      return { x, y: H - y }
    case 5:
      return { x: y, y: x }
    case 6:
      return { x: y, y: H - x }
    case 7:
      return { x: W - y, y: H - x }
    case 8:
      return { x: W - y, y: x }
  }
}

/**
 * 连续坐标逆变换：正向画面上的几何点 -> 原图平面中的几何点。
 * 裁切矩形四角用它映射回原图。
 */
export function inversePoint(p: Point, W: number, H: number, o: Orientation): Point {
  return continuousInverse(p, W, H, o)
}

/** 像素逆映射：正向画面像素 (i,j) -> 原图像素索引（整数）。 */
export function inversePixel(
  i: number,
  j: number,
  W: number,
  H: number,
  o: Orientation
): Point {
  // 像素版与连续版的差别仅在反射轴：连续 n-c 对应像素 n-1-c，
  // 即逆映射取整像素时直接用 n-1 形式。
  switch (o) {
    case 1:
      return { x: i, y: j }
    case 2:
      return { x: W - 1 - i, y: j }
    case 3:
      return { x: W - 1 - i, y: H - 1 - j }
    case 4:
      return { x: i, y: H - 1 - j }
    case 5:
      return { x: j, y: i }
    case 6:
      return { x: j, y: H - 1 - i }
    case 7:
      return { x: W - 1 - j, y: H - 1 - i }
    case 8:
      return { x: W - 1 - j, y: i }
  }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Polygon {
  tl: Point
  tr: Point
  bl: Point
  br: Point
}

/**
 * 把正向画面上的半开矩形 [x, x+w) × [y, y+h) 的四个几何角
 * 逆变换到原图连续平面。镜像方向会得到顶点顺序互换的多边形，
 * 因此四个角分别独立映射而非只映射两个角。
 */
export function inverseRectCorners(rect: Rect, W: number, H: number, o: Orientation): Polygon {
  const { x, y, w, h } = rect
  return {
    tl: inversePoint({ x, y }, W, H, o),
    tr: inversePoint({ x: x + w, y }, W, H, o),
    bl: inversePoint({ x, y: y + h }, W, H, o),
    br: inversePoint({ x: x + w, y: y + h }, W, H, o)
  }
}
