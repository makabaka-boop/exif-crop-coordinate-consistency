import { test, expect, type Page } from '@playwright/test'
import { browserSetup, SRC, SW, SH } from './fixture'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(browserSetup)
  await page.goto('/')
})

async function loadFixture(page: Page) {
  const file = await page.evaluate(() =>
    (window as any).__testUtils.makeSourceFile()
  )
  await page.evaluate((f) => {
    const dt = new DataTransfer()
    dt.items.add(f)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, file)
  await expect(page.getByTestId('display-size')).toHaveText(`${SW} × ${SH}`)
}

async function displayCanvasData(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.canvas-wrap canvas') as HTMLCanvasElement
    return (window as any).__testUtils.readCanvasRgba(canvas)
  })
}

async function getZoom(page: Page): Promise<number> {
  const z = await page.locator('.canvas-wrap').getAttribute('data-zoom')
  return Number(z)
}

/** 在 canvas 上按显示像素坐标拖出半开矩形。 */
async function dragPixelRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const zoom = await getZoom(page)
  const box = await page.locator('.canvas-wrap canvas').boundingBox()
  expect(box).toBeTruthy()
  const cx = (v: number) => box!.x + v * zoom
  const cy = (v: number) => box!.y + v * zoom
  // 落在像素内部，避免吸附边界的二义性
  await page.mouse.move(cx(x0 + 0.1), cy(y0 + 0.1))
  await page.mouse.down()
  await page.mouse.move(cx(x1 + 0.9), cy(y1 + 0.9), { steps: 4 })
  await page.mouse.up()
}

async function captureDownload(page: Page, trigger: () => Promise<void>) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    trigger()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function decodePngInPage(page: Page, bytes: Buffer) {
  return page.evaluate(async (b64) => {
    const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob())
    return (window as any).__testUtils.decodeBlobRgba(blob)
  }, bytes.toString('base64'))
}

function srcColor(x: number, y: number): number[] {
  return [...SRC[y][x], 255]
}

test.describe('EXIF 方向裁切：一次完整的选图、裁切、导出', () => {
  test('方向 6 下预览所见区域与导出 PNG 逐像素一致，JSON 坐标指向原图', async ({ page }) => {
    await loadFixture(page)

    // 初始方向 1：预览必须与源文件像素一致
    const initial = await displayCanvasData(page)
    for (let y = 0; y < SH; y++) {
      for (let x = 0; x < SW; x++) {
        const off = (y * SW + x) * 4
        expect(initial.slice(off, off + 4)).toEqual(srcColor(x, y))
      }
    }

    // 快速连续切换方向：旧的渲染结果必须被最终选择覆盖
    await page.getByTestId('orientation-select').selectOption('2')
    await page.getByTestId('orientation-select').selectOption('3')
    await page.getByTestId('orientation-select').selectOption('6')
    await expect(page.getByTestId('display-size')).toHaveText('3 × 4')

    // 方向 6（CW90）期望矩阵（显示宽 3 高 4），dst(i,j)=src(j,H-1-i)：
    //  K C R / O M B / P Y W / Br Gray W
    const display = await displayCanvasData(page)
    const dispW = 3
    const at = (x: number, y: number) => {
      const off = (y * dispW + x) * 4
      return display.slice(off, off + 4)
    }
    expect(at(0, 0)).toEqual(srcColor(0, 2)) // K
    expect(at(1, 0)).toEqual(srcColor(0, 1)) // C
    expect(at(2, 0)).toEqual(srcColor(0, 0)) // R
    expect(at(0, 1)).toEqual(srcColor(1, 2)) // O
    expect(at(0, 3)).toEqual(srcColor(3, 2)) // Br
    expect(at(2, 3)).toEqual(srcColor(3, 0)) // W

    // 非法矩形：在同一像素内抖动 → 吸附为 0×0，不给下载，但图片保留
    expect(await page.getByTestId('export-png').isDisabled()).toBe(true)
    await dragPixelRect(page, 0, 0, 0.2, 0.2)
    await expect(page.getByTestId('rect-info')).toHaveText('未选择')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(true)
    await expect(page.getByTestId('rect-check')).toContainText('至少为 1×1')
    await expect(page.getByTestId('display-size')).toHaveText('3 × 4') // 图片仍在

    // 合法矩形：正向画面 [0,0)-[2,2)
    await dragPixelRect(page, 0, 0, 2, 2)
    await expect(page.getByTestId('rect-info')).toContainText('2 × 2 px')
    await expect(page.getByTestId('rect-check')).toContainText('合法')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(false)

    // 预览区域像素（摄影师所见）
    const previewRegion: number[] = []
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) previewRegion.push(...at(x, y))
    }

    // 导出 PNG 并在浏览器内解码回像素
    const pngBytes = await captureDownload(page, async () => {
      await page.getByTestId('export-png').click()
    })
    const decoded = await decodePngInPage(page, pngBytes)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    // 逐像素：导出文件内容 == 预览所见 == 原图像素，无缩放
    expect(decoded.data).toEqual(previewRegion)
    expect(decoded.data).toEqual([
      ...srcColor(0, 2), ...srcColor(0, 1), // K C
      ...srcColor(1, 2), ...srcColor(1, 1)  // O M
    ])

    // 导出坐标 JSON
    const jsonBytes = await captureDownload(page, async () => {
      await page.getByTestId('export-json').click()
    })
    const json = JSON.parse(jsonBytes.toString('utf8'))
    expect(json.version).toBe(1)
    expect(json.orientation).toBe(6)
    expect(json.source).toMatchObject({ width: 4, height: 3, filename: 'fixture.png' })
    expect(json.display).toEqual({ width: 3, height: 4 })
    expect(json.crop).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    // inversePixel 方向6 = (j, H-1-i)：列沿原图 y-，行沿原图 x+
    expect(json.sourcePixelGrid).toMatchObject({
      originX: 0,
      originY: 2,
      colStepX: 0,
      colStepY: -1,
      rowStepX: 1,
      rowStepY: 0,
      width: 2,
      height: 2
    })
    // JSON 声明的每个原图坐标上的真实颜色，必须等于导出 PNG 对应像素
    const g = json.sourcePixelGrid
    let pi = 0
    for (let row = 0; row < g.height; row++) {
      for (let col = 0; col < g.width; col++) {
        const sx = g.originX + col * g.colStepX + row * g.rowStepX
        const sy = g.originY + col * g.colStepY + row * g.rowStepY
        expect(decoded.data.slice(pi * 4, pi * 4 + 4)).toEqual(srcColor(sx, sy))
        pi++
      }
    }
    // 四个连续几何角（半开）
    expect(json.corners.topLeft).toEqual({ x: 0, y: 3 })
    expect(json.corners.bottomRight).toEqual({ x: 2, y: 1 })
  })

  test('镜像方向 2：预览左上角像素来自原图右上，导出同样取对角落', async ({ page }) => {
    await loadFixture(page)
    await page.getByTestId('orientation-select').selectOption('2')
    await expect(page.getByTestId('display-size')).toHaveText('4 × 3')

    // 方向 2 水平镜像：正向左上角 = 原图右上角 = 白
    const display = await displayCanvasData(page)
    expect(display.slice(0, 4)).toEqual(srcColor(SW - 1, 0))

    await dragPixelRect(page, 0, 0, 1, 1)
    await expect(page.getByTestId('rect-check')).toContainText('合法')

    const pngBytes = await captureDownload(page, async () => {
      await page.getByTestId('export-png').click()
    })
    const decoded = await decodePngInPage(page, pngBytes)
    expect(decoded.width).toBe(1)
    expect(decoded.height).toBe(1)
    expect(decoded.data.slice(0, 4)).toEqual(srcColor(SW - 1, 0)) // 白，而非红
  })
})
