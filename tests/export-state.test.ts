import { describe, expect, it } from 'vitest'
import {
  createExportState,
  sameRect,
  snapshotStillCurrent
} from '../src/lib/export-state'
import { makeRgba } from '../src/lib/image'

const img = () => makeRgba(2, 3)

describe('createExportState：导出修订', () => {
  it('begin 后处于忙碌，end 解除', () => {
    const s = createExportState()
    const t = s.begin()
    expect(s.isExporting()).toBe(true)
    expect(s.isCurrent(t)).toBe(true)
    s.end()
    expect(s.isExporting()).toBe(false)
    expect(s.isCurrent(t)).toBe(true) // 正常结束不作废旧令牌语义
  })

  it('invalidate 解除忙碌并使旧令牌失效（改框/换方向/换图）', () => {
    const s = createExportState()
    const t0 = s.begin()
    const t1 = s.invalidate()
    expect(s.isExporting()).toBe(false)
    expect(s.isCurrent(t0)).toBe(false)
    expect(s.isCurrent(t1)).toBe(true)
  })

  it('迟到编码：失效后 resolve 的结果不能交付，新状态可再次 begin', async () => {
    const s = createExportState()
    const delivered: string[] = []

    async function staleExport(id: string, delayMs: number) {
      const token = s.begin()
      await new Promise((r) => setTimeout(r, delayMs))
      // 与 App.vue 同一守卫：令牌失效即丢弃，不 end、不交付
      if (!s.isCurrent(token)) return
      delivered.push(id)
      s.end()
    }

    const first = staleExport('old', 30)
    s.invalidate() // 用户改框
    const second = staleExport('new', 5)
    await Promise.all([first, second])

    expect(delivered).toEqual(['new'])
    expect(s.isExporting()).toBe(false)
  })
})

describe('sameRect', () => {
  it('null 与对象、对象间逐项比较', () => {
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect({ x: 1, y: 2, w: 3, h: 4 }, null)).toBe(false)
    expect(
      sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 })
    ).toBe(true)
    expect(
      sameRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 5 })
    ).toBe(false)
  })
})

describe('snapshotStillCurrent：图片/方向/矩形三者一致才交付', () => {
  const a = img()
  const b = img()
  const snap = { source: a, orientation: 6 as const, rect: { x: 0, y: 0, w: 1, h: 1 } }

  it('三者一致才通过', () => {
    expect(
      snapshotStillCurrent(snap, {
        source: a,
        orientation: 6,
        rect: { x: 0, y: 0, w: 1, h: 1 }
      })
    ).toBe(true)
  })

  it('改框 / 换方向 / 换图 / 清空矩形 均判过期', () => {
    expect(
      snapshotStillCurrent(snap, {
        source: a,
        orientation: 6,
        rect: { x: 0, y: 0, w: 2, h: 1 }
      })
    ).toBe(false)
    expect(
      snapshotStillCurrent(snap, { source: a, orientation: 3, rect: snap.rect })
    ).toBe(false)
    expect(
      snapshotStillCurrent(snap, { source: b, orientation: 6, rect: snap.rect })
    ).toBe(false)
    expect(
      snapshotStillCurrent(snap, { source: a, orientation: 6, rect: null })
    ).toBe(false)
  })
})
