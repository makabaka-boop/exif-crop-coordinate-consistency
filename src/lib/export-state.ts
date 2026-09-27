import { ref } from 'vue'
import type { Orientation, Rect } from './geometry'
import type { RgbaImage } from './image'
import { createRevisionGuard, type RevisionToken } from './revision'

/**
 * 交付快照：一次被确认的可导出状态，由「原图 + 方向 + 整像素半开矩形」
 * 三者共同唯一确定。PNG 与 JSON 必须从同一份快照生成；异步编码结束时
 * 只有当前确认状态仍与快照一致，产物才允许交付（下载/提示）。
 */
export interface ExportSnapshot {
  source: RgbaImage
  orientation: Orientation
  rect: Rect
}

/**
 * 导出修订状态。除图片/方向外，**已确认矩形的任何改动**也会立即使进行中
 * 的导出失效，迟到的编码结果不得改写新状态、不得下载、不得显示成功提示。
 *
 * exporting 是响应式标志：失效发生在任意回调里，按钮禁用态必须立刻更新。
 */
export function createExportState() {
  const guard = createRevisionGuard()
  const exporting = ref(false)

  /** 是否存在进行中的导出（用于禁用导出按钮）。 */
  function isExporting(): boolean {
    return exporting.value
  }

  /** 开始一次导出：标记忙碌并捕获当前修订令牌。 */
  function begin(token: RevisionToken = guard.current()): RevisionToken {
    exporting.value = true
    return token
  }

  /** 导出正常结束（成功/失败），解除忙碌。 */
  function end(): void {
    exporting.value = false
  }

  /**
   * 作废进行中的导出：图片换入、方向切换或已确认矩形改变时调用。
   * 解除忙碌并使旧令牌失效，旧编码迟到时只能被丢弃。
   */
  function invalidate(): RevisionToken {
    exporting.value = false
    return guard.bump()
  }

  function current(): RevisionToken {
    return guard.current()
  }

  function isCurrent(token: RevisionToken): boolean {
    return guard.isCurrent(token)
  }

  return {
    exporting,
    isExporting,
    begin,
    end,
    invalidate,
    current,
    isCurrent
  }
}

/** 结构相等：两个半开矩形逐项相同。 */
export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * 编码完成后复核：快照中的图片、方向、矩形是否仍与当前确认状态完全一致。
 * 任一不符即视为迟到结果，调用方必须丢弃，不下载、不提示成功。
 */
export function snapshotStillCurrent(
  snapshot: ExportSnapshot,
  current: { source: RgbaImage | null; orientation: Orientation; rect: Rect | null }
): boolean {
  return (
    current.source === snapshot.source &&
    current.orientation === snapshot.orientation &&
    sameRect(current.rect, snapshot.rect)
  )
}
