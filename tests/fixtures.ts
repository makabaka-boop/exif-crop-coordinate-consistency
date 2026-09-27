import { makeRgba, type RgbaImage } from '../src/lib/image'

/**
 * 非对称 2 宽 × 3 高 的彩色像素矩阵（每个像素颜色/位置都唯一，
 * 因此任何旋转、镜像或取错角都会立刻被发现）：
 *
 *        x=0 红系        x=1 蓝系
 *  y=0   红  (255,0,0)   蓝   (0,0,255)
 *  y=1   绿  (0,255,0)   青   (0,255,255)
 *  y=2   白  (255,255,255) 黑 (0,0,0)
 */
export const W = 2
export const H = 3

export type RGBA = [number, number, number, number]

export const COLORS: Record<string, RGBA> = {
  R: [255, 0, 0, 255],
  G: [0, 255, 0, 255],
  W: [255, 255, 255, 255],
  B: [0, 0, 255, 255],
  C: [0, 255, 255, 255],
  K: [0, 0, 0, 255]
}

/** 原始矩阵（行从上到下）。 */
export const SOURCE_GRID: string[][] = [
  ['R', 'B'],
  ['G', 'C'],
  ['W', 'K']
]

/** 八种 EXIF 方向下正向画面的期望矩阵。 */
export const EXPECTED_ORIENTED_GRIDS: Record<number, string[][]> = {
  1: [
    ['R', 'B'],
    ['G', 'C'],
    ['W', 'K']
  ],
  2: [
    ['B', 'R'],
    ['C', 'G'],
    ['K', 'W']
  ],
  3: [
    ['K', 'W'],
    ['C', 'G'],
    ['B', 'R']
  ],
  4: [
    ['W', 'K'],
    ['G', 'C'],
    ['R', 'B']
  ],
  // 5: 转置，3 宽 × 2 高；dst(x=y, y=x)
  5: [
    ['R', 'G', 'W'],
    ['B', 'C', 'K']
  ],
  // 6: 顺时针 90°，3 宽 × 2 高；dst(y, W-1-x)
  6: [
    ['W', 'G', 'R'],
    ['K', 'C', 'B']
  ],
  // 7: 副对角线镜像，3 宽 × 2 高
  7: [
    ['K', 'C', 'B'],
    ['W', 'G', 'R']
  ],
  // 8: 逆时针 90°，3 宽 × 2 高
  8: [
    ['B', 'C', 'K'],
    ['R', 'G', 'W']
  ]
}

export function gridToRgba(grid: string[][]): RgbaImage {
  const h = grid.length
  const w = grid[0].length
  const img = makeRgba(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = COLORS[grid[y][x]]
      const off = (y * w + x) * 4
      img.data.set(c, off)
    }
  }
  return img
}

export function sourceRgba(): RgbaImage {
  return gridToRgba(SOURCE_GRID)
}

export function rgbaAt(img: RgbaImage, x: number, y: number): RGBA {
  const off = (y * img.width + x) * 4
  return [img.data[off], img.data[off + 1], img.data[off + 2], img.data[off + 3]]
}

export function rgbaToName(c: RGBA): string {
  for (const [name, value] of Object.entries(COLORS)) {
    if (value.every((v, i) => v === c[i])) return name
  }
  throw new Error(`未知颜色 ${c.join(',')}`)
}

export function imgToGrid(img: RgbaImage): string[][] {
  const grid: string[][] = []
  for (let y = 0; y < img.height; y++) {
    const row: string[] = []
    for (let x = 0; x < img.width; x++) row.push(rgbaToName(rgbaAt(img, x, y)))
    grid.push(row)
  }
  return grid
}
