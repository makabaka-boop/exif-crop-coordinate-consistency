import { test, expect, type Page } from '@playwright/test'
import { browserSetup, SRC, SW, SH, SRC_B, SW_B, SH_B } from './fixture'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(browserSetup)
  await page.goto('/')
})

async function loadImage(page: Page, which: 'a' | 'b') {
  const file = await page.evaluate(
    (w) => (window as any).__testUtils.makeSourceFile(w),
    which
  )
  await page.evaluate((f) => {
    const dt = new DataTransfer()
    dt.items.add(f)
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, file)
  const w = which === 'a' ? SW : SW_B
  const h = which === 'a' ? SH : SH_B
  await expect(page.getByTestId('display-size')).toHaveText(`${w} × ${h}`)
}

async function getZoom(page: Page): Promise<number> {
  const z = await page.locator('.canvas-wrap').getAttribute('data-zoom')
  return Number(z)
}

async function canvasBox(page: Page) {
  const box = await page.locator('.canvas-wrap canvas').boundingBox()
  expect(box).toBeTruthy()
  return box!
}

/** 在 canvas 上按图像像素坐标拖出半开矩形（落点取像素内部，避开吸附二义性）。 */
async function dragPixelRect(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const zoom = await getZoom(page)
  const box = await canvasBox(page)
  const cx = (v: number) => box.x + v * zoom
  const cy = (v: number) => box.y + v * zoom
  await page.mouse.move(cx(x0 + 0.1), cy(y0 + 0.1))
  await page.mouse.down()
  await page.mouse.move(cx(x1 + 0.9), cy(y1 + 0.9), { steps: 4 })
  await page.mouse.up()
}

/**
 * 可控的指针取消：按下并拖动后，不派发 pointerup，
 * 而是向（已捕获指针的）canvas 派发浏览器级 pointercancel。
 */
async function dragThenCancel(
  page: Page,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) {
  const zoom = await getZoom(page)
  const box = await canvasBox(page)
  const cx = (v: number) => box.x + v * zoom
  const cy = (v: number) => box.y + v * zoom
  await page.mouse.move(cx(x0 + 0.1), cy(y0 + 0.1))
  await page.mouse.down()
  await page.mouse.move(cx(x1 + 0.9), cy(y1 + 0.9), { steps: 4 })
  await page.locator('.canvas-wrap canvas').dispatchEvent('pointercancel')
  await page.mouse.up() // 释放物理按键；此时手势已撤销，pointerup 是空操作
}

async function installGate(page: Page) {
  await page.evaluate(() => (window as any).__testUtils.installEncodeGate())
}

async function gatePending(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testEncodeDelayGate.pendingCount())
}

async function releaseGate(page: Page) {
  await page.evaluate(() => (window as any).__testEncodeDelayGate.release())
}

async function captureDownload(page: Page, trigger: () => Promise<void>) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    trigger()
  ])
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) }
}

async function decodePng(page: Page, bytes: Buffer) {
  return page.evaluate(async (b64) => {
    const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob())
    return (window as any).__testUtils.decodeBlobRgba(blob)
  }, bytes.toString('base64'))
}

function color(grid: number[][][], x: number, y: number): number[] {
  return [...grid[y][x], 255]
}

test.describe('手势取消：未确认区域绝不采纳', () => {
  test('拖框期间收到指针取消：撤销手势并恢复此前已确认矩形，不开放下载', async ({
    page
  }) => {
    await loadImage(page, 'a')

    // 先确认一个合法矩形 [0,0)-[2,2)
    await dragPixelRect(page, 0, 0, 2, 2)
    await expect(page.getByTestId('rect-info')).toContainText('2 × 2 px')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(false)

    // 试图拖出另一个区域 [2,1)-[4,3)，但手势被取消
    await dragThenCancel(page, 2, 1, 3, 2)

    // 未完成手势不采纳：仍是旧的已确认矩形，下载保持可用且对应旧框
    await expect(page.getByTestId('rect-info')).toContainText('2 × 2 px')
    await expect(page.getByTestId('rect-check')).toContainText('合法')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(false)
  })

  test('此前没有已确认矩形时取消：保持无矩形，导出持续禁用', async ({ page }) => {
    await loadImage(page, 'b')
    await dragThenCancel(page, 0, 0, 2, 1)
    await expect(page.getByTestId('rect-info')).toHaveText('未选择')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(true)
    expect(await page.getByTestId('export-json').isDisabled()).toBe(true)
  })
})

test.describe('编码期间改框：只有与当前确认状态一致的产物才交付', () => {
  test('延迟编码结束前改矩形：旧 PNG 不下载、成功提示不落在新框旁；新框产物像素/网格一致', async ({
    page
  }) => {
    const downloads: string[] = []
    page.on('download', (d) => downloads.push(d.suggestedFilename()))

    await installGate(page)
    await loadImage(page, 'a')

    // 旧框 R1 = [0,0)-[2,2)（2×2），启动导出但编码挂起
    await dragPixelRect(page, 0, 0, 2, 2)
    await page.getByTestId('export-png').click()
    await expect.poll(() => gatePending(page)).toBe(1)
    expect(await page.getByTestId('export-png').isDisabled()).toBe(true)

    // 编码期间改成新框 R2 = [1,0)-[4,3)（3×3）
    await dragPixelRect(page, 1, 0, 3, 2)
    await expect(page.getByTestId('rect-info')).toContainText('3 × 3 px')
    // 矩形改变即解除忙碌：新框合法，导出按钮立即恢复
    expect(await page.getByTestId('export-png').isDisabled()).toBe(false)

    // 放行旧编码：迟到结果必须被丢弃
    await releaseGate(page)
    await page.waitForTimeout(700)
    expect(downloads).toEqual([])
    // 状态不能出现属于旧框的成功提示（编码开始时只显示「正在…」）
    await expect(page.getByTestId('status')).not.toContainText('已导出正向 PNG')

    // 导出当前新框 PNG
    const png = await captureDownload(page, async () => {
      await page.getByTestId('export-png').click()
    })
    const decoded = await decodePng(page, png.bytes)
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(3)
    // 逐像素：文件内容必须是新框区域（图 A 的 x=1..3, y=0..2）
    let pi = 0
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(decoded.data.slice(pi * 4, pi * 4 + 4)).toEqual(
          color(SRC, x + 1, y)
        )
        pi++
      }
    }
    await expect(page.getByTestId('status')).toContainText('3×3')

    // 导出同一确认状态的 JSON：网格逐项指向 PNG 对应像素的原图位置
    const jsonFile = await captureDownload(page, async () => {
      await page.getByTestId('export-json').click()
    })
    const json = JSON.parse(jsonFile.bytes.toString('utf8'))
    expect(json.version).toBe(1)
    expect(json.source).toMatchObject({ width: SW, height: SH, filename: 'fixture.png' })
    expect(json.crop).toEqual({ x: 1, y: 0, width: 3, height: 3 })
    const g = json.sourcePixelGrid
    expect(g).toMatchObject({
      originX: 1,
      originY: 0,
      colStepX: 1,
      colStepY: 0,
      rowStepX: 0,
      rowStepY: 1,
      width: 3,
      height: 3
    })
    let gi = 0
    for (let row = 0; row < g.height; row++) {
      for (let col = 0; col < g.width; col++) {
        const sx = g.originX + col * g.colStepX + row * g.rowStepX
        const sy = g.originY + col * g.colStepY + row * g.rowStepY
        expect(decoded.data.slice(gi * 4, gi * 4 + 4)).toEqual(color(SRC, sx, sy))
        gi++
      }
    }

    // 整个过程只产生新框的 PNG + JSON 两个下载，没有旧框文件
    expect(downloads).toHaveLength(2)
  })
})

test.describe('编码期间换图：新图必须可再次导出，迟到结果不得改写新状态', () => {
  test('旧编码挂起时换入另一张合法照片：放行旧编码无下载，新图拖框后可导出且像素/网格一致', async ({
    page
  }) => {
    const downloads: string[] = []
    page.on('download', (d) => downloads.push(d.suggestedFilename()))

    await installGate(page)
    await loadImage(page, 'a')

    // 图 A 上确认矩形并启动导出，编码挂起
    await dragPixelRect(page, 0, 0, 2, 2)
    await page.getByTestId('export-png').click()
    await expect.poll(() => gatePending(page)).toBe(1)

    // 编码期间换入图 B（3×2，合法解码）
    await loadImage(page, 'b')
    await expect(page.getByTestId('rect-info')).toHaveText('未选择')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(true)

    // 放行图 A 的旧编码：不得下载，不得提示成功
    await releaseGate(page)
    await page.waitForTimeout(700)
    expect(downloads).toEqual([])
    await expect(page.getByTestId('status')).not.toContainText('已导出正向 PNG')

    // 新图完成拖框后导出必须恢复正常（回归：按钮曾永久禁用）
    await dragPixelRect(page, 0, 0, 2, 1)
    await expect(page.getByTestId('rect-info')).toContainText('2 × 2 px')
    expect(await page.getByTestId('export-png').isDisabled()).toBe(false)

    const png = await captureDownload(page, async () => {
      await page.getByTestId('export-png').click()
    })
    const decoded = await decodePng(page, png.bytes)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    let pi = 0
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        expect(decoded.data.slice(pi * 4, pi * 4 + 4)).toEqual(
          color(SRC_B, x, y)
        )
        pi++
      }
    }

    // JSON 必须属于图 B，网格与 PNG 逐项一致（不能被图 A 的迟到结果污染）
    const jsonFile = await captureDownload(page, async () => {
      await page.getByTestId('export-json').click()
    })
    const json = JSON.parse(jsonFile.bytes.toString('utf8'))
    expect(json.source).toMatchObject({
      width: SW_B,
      height: SH_B,
      filename: 'other.png'
    })
    expect(json.orientation).toBe(1)
    expect(json.crop).toEqual({ x: 0, y: 0, width: 2, height: 2 })
    const g = json.sourcePixelGrid
    let gi = 0
    for (let row = 0; row < g.height; row++) {
      for (let col = 0; col < g.width; col++) {
        const sx = g.originX + col * g.colStepX + row * g.rowStepX
        const sy = g.originY + col * g.colStepY + row * g.rowStepY
        expect(decoded.data.slice(gi * 4, gi * 4 + 4)).toEqual(
          color(SRC_B, sx, sy)
        )
        gi++
      }
    }

    expect(downloads).toHaveLength(2)
  })
})
