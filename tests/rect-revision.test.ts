import { describe, expect, it } from 'vitest'
import { checkCropRect, snapDragRect } from '../src/lib/image'
import { createRevisionGuard } from '../src/lib/revision'

describe('snapDragRect：半开整像素矩形', () => {
  it('起止点分别吸附到最近整数边界后规范化', () => {
    expect(snapDragRect({ x: 0.2, y: 0.6 }, { x: 2.4, y: 3.4 })).toEqual({
      x: 0,
      y: 1,
      w: 2,
      h: 2
    })
  })

  it('反向拖动（右下到左上）也能规范化', () => {
    expect(snapDragRect({ x: 4, y: 5 }, { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 3
    })
  })

  it('同一点或亚像素抖动吸附为零尺寸（调用方据此不给下载）', () => {
    expect(snapDragRect({ x: 1.2, y: 1.2 }, { x: 1.3, y: 1.3 })).toEqual({
      x: 1,
      y: 1,
      w: 0,
      h: 0
    })
  })
})

describe('checkCropRect', () => {
  it('合法矩形通过', () => {
    expect(checkCropRect({ x: 0, y: 0, w: 1, h: 1 }, 3, 2)).toEqual({ valid: true })
    expect(checkCropRect({ x: 2, y: 1, w: 1, h: 1 }, 3, 2)).toEqual({ valid: true })
  })

  it('零/负尺寸非法', () => {
    expect(checkCropRect({ x: 0, y: 0, w: 0, h: 1 }, 3, 2).valid).toBe(false)
    expect(checkCropRect({ x: 0, y: 0, w: 2, h: -1 }, 3, 2).valid).toBe(false)
  })

  it('越界非法（含半开右端点 == 宽）', () => {
    expect(checkCropRect({ x: 2, y: 0, w: 2, h: 1 }, 3, 2).valid).toBe(false)
    expect(checkCropRect({ x: -1, y: 0, w: 1, h: 1 }, 3, 2).valid).toBe(false)
    expect(checkCropRect({ x: 0, y: 1, w: 1, h: 2 }, 3, 2).valid).toBe(false)
  })

  it('非整数边界非法', () => {
    expect(checkCropRect({ x: 0.5, y: 0, w: 1, h: 1 }, 3, 2).valid).toBe(false)
  })
})

describe('修订令牌：变更后旧异步结果失效', () => {
  it('bump 后旧令牌不再 current，新令牌有效', () => {
    const guard = createRevisionGuard()
    const t0 = guard.current()
    const t1 = guard.bump()
    expect(guard.isCurrent(t0)).toBe(false)
    expect(guard.isCurrent(t1)).toBe(true)
    const t2 = guard.bump()
    expect(guard.isCurrent(t1)).toBe(false)
    expect(guard.isCurrent(t2)).toBe(true)
  })

  it('模拟迟到解码：图片切换后旧解码 resolve 必须被丢弃', async () => {
    const guard = createRevisionGuard()
    const committed: string[] = []

    async function staleDecode(id: string, delayMs: number): Promise<void> {
      const token = guard.current()
      await new Promise((r) => setTimeout(r, delayMs))
      // 仅在令牌未变时提交（与 App.vue 同一守卫模式）
      if (guard.isCurrent(token)) committed.push(id)
    }

    const first = staleDecode('old.png', 30)
    guard.bump() // 用户立即换了图
    const second = staleDecode('new.png', 5)
    await Promise.all([first, second])

    expect(committed).toEqual(['new.png'])
  })
})
