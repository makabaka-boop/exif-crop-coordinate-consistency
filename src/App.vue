<script setup lang="ts">
import { computed, ref } from 'vue'
import CropStage from './components/CropStage.vue'
import {
  ORIENTATIONS,
  isOrientation,
  type Orientation,
  type Rect
} from './lib/geometry'
import {
  buildOrientedRgba,
  checkCropRect,
  cropFromSource,
  type RgbaImage
} from './lib/image'
import { buildCropMappingJson } from './lib/mapping-json'
import { createRevisionGuard } from './lib/revision'
import {
  createExportState,
  snapshotStillCurrent,
  type ExportSnapshot
} from './lib/export-state'
import {
  decodeImageFile,
  downloadBlob,
  downloadJson,
  encodePng
} from './lib/canvas-codec'

const ACCEPTED = ['image/png', 'image/jpeg']

const guard = createRevisionGuard()
// 导出修订独立于解码：矩形的改变也必须使进行中的编码立即失效
const exportState = createExportState()

const original = ref<RgbaImage | null>(null)
const display = ref<RgbaImage | null>(null)
const filename = ref<string | null>(null)
const mediaType = ref<string>('')
const orientation = ref<Orientation>(1)
const cropRect = ref<Rect | null>(null)
const busy = ref(false)
const status = ref('就绪：选择本地 PNG/JPEG 开始')
const statusKind = ref<'info' | 'error' | 'ok'>('info')

function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info') {
  status.value = text
  statusKind.value = kind
}

const displaySize = computed(() =>
  display.value ? { w: display.value.width, h: display.value.height } : null
)

const rectCheck = computed(() => {
  if (!display.value || !cropRect.value) {
    return { valid: false, reason: '请先拖出裁切区域' }
  }
  return checkCropRect(
    cropRect.value,
    display.value.width,
    display.value.height
  )
})

const canExport = computed(
  () => !busy.value && !exportState.exporting.value && rectCheck.value.valid
)

async function onFileChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!ACCEPTED.includes(file.type)) {
    setStatus('仅支持本地 PNG 或 JPEG 文件', 'error')
    input.value = ''
    return
  }

  // 图片变更：旧异步解码与旧导出全部失效
  const token = guard.bump()
  exportState.invalidate()
  busy.value = true
  setStatus('正在本地解码图片…')
  try {
    const decoded = await decodeImageFile(file)
    if (!guard.isCurrent(token)) return // 已被更新的图片/方向取代
    original.value = decoded
    filename.value = file.name
    mediaType.value = file.type
    orientation.value = 1
    cropRect.value = null
    display.value = buildOrientedRgba(decoded, 1)
    setStatus(`已载入 ${file.name}（${decoded.width}×${decoded.height} 原始像素）`, 'ok')
  } catch (err) {
    if (guard.isCurrent(token)) {
      // 解码失败保留当前图片（如果之前有），仅提示
      setStatus(`解码失败：${(err as Error).message}`, 'error')
    }
  } finally {
    if (guard.isCurrent(token)) busy.value = false
    input.value = ''
  }
}

function onOrientationChange(e: Event) {
  const value = Number((e.target as HTMLSelectElement).value)
  if (!isOrientation(value)) return
  if (value === orientation.value) return

  // 方向变更：重建正向预览，旧导出立即失效，旧裁切矩形清空
  guard.bump()
  exportState.invalidate()
  orientation.value = value
  cropRect.value = null
  if (original.value) {
    display.value = buildOrientedRgba(original.value, value)
    setStatus(`已套用 EXIF 方向 ${value}：正向预览 ${display.value.width}×${display.value.height}`, 'ok')
  }
}

/**
 * 已确认矩形的唯一写入口。新矩形只有在手势正常结束（非取消）时到达；
 * 矩形的任何改变都作废旧导出，迟到编码不得覆盖当前确认状态。
 */
function onRectUpdate(rect: Rect | null) {
  if (rect === cropRect.value) return
  cropRect.value = rect
  exportState.invalidate()
}

function currentSnapshot(): ExportSnapshot | null {
  if (!original.value || !cropRect.value || !rectCheck.value.valid) return null
  return {
    source: original.value,
    orientation: orientation.value,
    rect: cropRect.value
  }
}

function confirmedNow(): {
  source: RgbaImage | null
  orientation: Orientation
  rect: Rect | null
} {
  return {
    source: original.value,
    orientation: orientation.value,
    rect: cropRect.value
  }
}

function baseExportName(): string {
  const stem = filename.value ? filename.value.replace(/\.[^.]+$/, '') : 'image'
  return `${stem}.orient${orientation.value}.crop`
}

async function exportPng() {
  const snapshot = currentSnapshot()
  if (!snapshot) return
  // 捕获快照与令牌：图片、方向、矩形三者共同标识这一次交付
  const token = exportState.begin()
  setStatus('正在从原始像素导出 PNG…')
  try {
    // 像素在等待前就按快照裁好；编码期间 UI 状态再怎么变也不影响它
    const cropped = cropFromSource(
      snapshot.source,
      snapshot.orientation,
      snapshot.rect
    )
    const blob = await encodePng(cropped)
    // 编码结束必须复核：只有图片、方向、矩形均与当前确认状态一致才交付。
    // 迟到结果（改框/换方向/换图）不下载、不提示、不改写任何状态。
    if (!exportState.isCurrent(token)) return
    if (!snapshotStillCurrent(snapshot, confirmedNow())) return
    downloadBlob(blob, `${baseExportName()}.png`)
    setStatus(`已导出正向 PNG：${cropped.width}×${cropped.height}，原始像素无缩放`, 'ok')
  } catch (err) {
    if (exportState.isCurrent(token)) setStatus(`导出失败：${(err as Error).message}`, 'error')
  } finally {
    if (exportState.isCurrent(token)) exportState.end()
  }
}

function exportMappingJson() {
  const snapshot = currentSnapshot()
  if (!snapshot || !original.value) return
  // JSON 与 PNG 必须同源：从同一份确认快照（同图片、同方向、同矩形）生成，
  // 网格与像素一一对应。同步交付，不存在迟到窗口。
  const json = buildCropMappingJson({
    source: snapshot.source,
    filename: filename.value,
    mediaType: mediaType.value,
    orientation: snapshot.orientation,
    crop: {
      x: snapshot.rect.x,
      y: snapshot.rect.y,
      width: snapshot.rect.w,
      height: snapshot.rect.h
    }
  })
  downloadJson(json, `${baseExportName()}.json`)
  setStatus('已导出原图坐标映射 JSON', 'ok')
}

const orientationLabels: Record<Orientation, string> = {
  1: '1 — 正常',
  2: '2 — 水平镜像',
  3: '3 — 旋转 180°',
  4: '4 — 垂直镜像',
  5: '5 — 转置（主对角线镜像）',
  6: '6 — 顺时针 90°',
  7: '7 — 横向翻转（副对角线镜像）',
  8: '8 — 逆时针 90°'
}
</script>

<template>
  <main class="app">
    <header>
      <h1>EXIF 方向裁切工作室</h1>
      <p class="subtitle">零后端 · 本地处理 · 镜像方向感知 · 整像素半开矩形 · 原始像素无缩放导出</p>
    </header>

    <section class="controls">
      <label class="file-picker">
        <span>选择图片（PNG/JPEG）</span>
        <input
          type="file"
          accept="image/png,image/jpeg"
          :disabled="busy"
          @change="onFileChosen"
        />
      </label>

      <label class="orientation-picker">
        <span>EXIF 方向</span>
        <select
          data-testid="orientation-select"
          :value="orientation"
          :disabled="busy || !original"
          @change="onOrientationChange"
        >
          <option v-for="o in ORIENTATIONS" :key="o" :value="o">
            {{ orientationLabels[o] }}
          </option>
        </select>
      </label>

      <div class="actions">
        <button
          type="button"
          data-testid="export-png"
          :disabled="!canExport"
          @click="exportPng"
        >
          导出 PNG
        </button>
        <button
          type="button"
          data-testid="export-json"
          :disabled="!canExport"
          @click="exportMappingJson"
        >
          导出坐标 JSON
        </button>
      </div>
    </section>

    <p class="status" :class="statusKind" data-testid="status" role="status">
      {{ status }}
    </p>

    <CropStage
      :model-value="cropRect"
      :display="display"
      :disabled="busy"
      @update:model-value="onRectUpdate"
    />

    <dl v-if="displaySize" class="meta">
      <div><dt>正向预览</dt><dd data-testid="display-size">{{ displaySize.w }} × {{ displaySize.h }}</dd></div>
      <div>
        <dt>裁切矩形（半开）</dt>
        <dd data-testid="rect-info">
          <template v-if="cropRect">
            [{{ cropRect.x }}, {{ cropRect.y }}) —
            [{{ cropRect.x + cropRect.w }}, {{ cropRect.y + cropRect.h }})
            ＝ {{ cropRect.w }} × {{ cropRect.h }} px
          </template>
          <template v-else>未选择</template>
        </dd>
      </div>
      <div>
        <dt>校验</dt>
        <dd data-testid="rect-check" :class="{ bad: !rectCheck.valid }">
          {{ rectCheck.valid ? '合法：可以导出' : rectCheck.reason }}
        </dd>
      </div>
    </dl>
  </main>
</template>

<style scoped>
.app {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: #1f2430;
}

header h1 {
  font-size: 22px;
  margin: 0 0 4px;
}

.subtitle {
  margin: 0 0 20px;
  color: #6b7280;
  font-size: 13px;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-end;
  margin-bottom: 12px;
}

.controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #4b5563;
}

.controls select,
.file-picker {
  font-size: 13px;
}

select {
  padding: 6px 8px;
  border: 1px solid #c4cad4;
  border-radius: 6px;
  background: #fff;
}

.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

button {
  padding: 8px 14px;
  border: none;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

button:disabled {
  background: #b6c2d6;
  cursor: not-allowed;
}

.status {
  font-size: 13px;
  margin: 0 0 12px;
}

.status.info { color: #4b5563; }
.status.ok { color: #15803d; }
.status.error { color: #b91c1c; }

.meta {
  display: flex;
  gap: 28px;
  margin: 14px 0 0;
  font-size: 13px;
  flex-wrap: wrap;
}

.meta dt {
  color: #6b7280;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.meta dd {
  margin: 2px 0 0;
  font-variant-numeric: tabular-nums;
}

.meta dd.bad {
  color: #b91c1c;
}
</style>
