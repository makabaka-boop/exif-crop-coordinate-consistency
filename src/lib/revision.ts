/**
 * 修订令牌：方向或图片变更时递增，使所有进行中的旧异步解码、
 * 旧导出在 resolve 时判定过期并被丢弃（过期结果不写入任何状态）。
 */
export type RevisionToken = number

export function createRevisionGuard(): {
  /** 当前令牌；开始一次异步工作时捕获它。 */
  current: () => RevisionToken
  /** 使所有旧令牌失效并返回新令牌（方向/图片变更时调用）。 */
  bump: () => RevisionToken
  /** 判断异步开始时捕获的令牌是否仍然有效。 */
  isCurrent: (token: RevisionToken) => boolean
} {
  let rev = 0
  return {
    current: () => rev,
    bump: () => {
      rev += 1
      return rev
    },
    isCurrent: (token) => token === rev
  }
}
