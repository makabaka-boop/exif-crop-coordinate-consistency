<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Rect } from '../lib/geometry'
import { snapDragRect, type RgbaImage } from '../lib/image'
import { paintToCanvas } from '../lib/canvas-codec'

const props = defineProps<{
  display: RgbaImage | null
  modelValue: Rect | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Rect | null): void
}>()

const wrapper = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const wrapperWidth = ref(720)

let ro: ResizeObserver | null = null

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    for (const entry of entries) wrapperWidth.value = entry.contentRect.width
  })
  if (wrapper.value) ro.observe(wrapper.value)
})

onBeforeUnmount(() => ro?.disconnect())

/** 纯整数倍放大：每个图像像素仍是屏幕上的正方整块，所见即所得。 */
const zoom = computed(() => {
  if (!props.display) return 1
  return Math.max(1, Math.min(48, Math.floor(wrapperWidth.value / props.display.width)))
})

watch(
  () => props.display,
  (img) => {
    if (img && canvas.value) paintToCanvas(img, canvas.value)
  },
  { immediate: true }
)

interface Pt {
  x: number
  y: number
}

const dragging = ref(false)
const startPt = ref<Pt | null>(null)
const currentPt = ref<Pt | null>(null)
const liveRect = ref<Rect | null>(null)
/**
 * 手势开始前的已确认矩形。拖框期间 modelValue 被暂时清空，
 * 若指针被取消（而非正常抬起），必须撤销整次手势并恢复它——
 * 取消不是确认，未完成的手势不能覆盖此前已确认的裁切。
 */
const rectBeforeDrag = ref<Rect | null>(null)

function eventToImagePoint(e: PointerEvent): Pt {
  const c = canvas.value
  const d = props.display
  if (!c || !d) return { x: 0, y: 0 }
  const box = c.getBoundingClientRect()
  const z = zoom.value
  const x = Math.min(d.width, Math.max(0, (e.clientX - box.left) / z))
  const y = Math.min(d.height, Math.max(0, (e.clientY - box.top) / z))
  return { x, y }
}

function onPointerDown(e: PointerEvent) {
  if (dragging.value || !props.display || props.disabled) return
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  dragging.value = true
  startPt.value = eventToImagePoint(e)
  currentPt.value = { ...startPt.value }
  liveRect.value = { x: startPt.value.x, y: startPt.value.y, w: 0, h: 0 }
  rectBeforeDrag.value = props.modelValue
  // 拖框期间没有已确认矩形：未经确认的区域绝不允许下载
  emit('update:modelValue', null)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !startPt.value) return
  const p = eventToImagePoint(e)
  currentPt.value = p
  const s = startPt.value
  liveRect.value = {
    x: Math.min(s.x, p.x),
    y: Math.min(s.y, p.y),
    w: Math.abs(p.x - s.x),
    h: Math.abs(p.y - s.y)
  }
}

function resetGesture() {
  dragging.value = false
  startPt.value = null
  currentPt.value = null
  liveRect.value = null
  rectBeforeDrag.value = null
}

function onPointerUp() {
  if (!dragging.value || !startPt.value || !currentPt.value) {
    resetGesture()
    return
  }
  // 起止点分别吸附到最近整像素边界，再规范成半开矩形
  const snapped = snapDragRect(startPt.value, currentPt.value)
  resetGesture()
  emit('update:modelValue', snapped.w >= 1 && snapped.h >= 1 ? snapped : null)
}

/**
 * 指针取消（浏览器/系统打断手势，如触摸被来电中断、触控笔离开）：
 * 撤销整次手势，恢复手势开始前的已确认矩形，绝不采纳未完成的拖框。
 */
function onPointerCancel() {
  if (!dragging.value) return
  const previous = rectBeforeDrag.value
  resetGesture()
  emit('update:modelValue', previous)
}

function overlayStyle(r: Rect) {
  const z = zoom.value
  return {
    left: `${r.x * z}px`,
    top: `${r.y * z}px`,
    width: `${r.w * z}px`,
    height: `${r.h * z}px`
  }
}
</script>

<template>
  <div ref="wrapper" class="stage">
    <div v-if="display" class="canvas-wrap" :data-zoom="zoom">
      <canvas
        ref="canvas"
        class="bitmap"
        :class="{ disabled: disabled }"
        :style="{
          width: `${display.width * zoom}px`,
          height: `${display.height * zoom}px`,
          imageRendering: 'pixelated'
        }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      />
      <!-- 拖动中的实时矩形 -->
      <div v-if="liveRect" class="overlay live" :style="overlayStyle(liveRect)" />
      <!-- 已确认的整像素半开矩形 -->
      <div v-else-if="modelValue" class="overlay" :style="overlayStyle(modelValue)" />
    </div>
    <p v-else class="placeholder">选择一张本地 PNG 或 JPEG 后在此预览</p>
  </div>
</template>

<style scoped>
.stage {
  width: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: repeating-conic-gradient(#eef0f3 0% 25%, #f7f8fa 0% 50%) 0 0 / 24px 24px;
  border: 1px solid #d8dce2;
  border-radius: 10px;
  padding: 16px;
  box-sizing: border-box;
  overflow: auto;
}

.canvas-wrap {
  position: relative;
  line-height: 0;
}

.bitmap {
  display: block;
  touch-action: none;
  cursor: crosshair;
  border-radius: 2px;
  box-shadow: 0 0 0 1px #b9c0ca;
}

.bitmap.disabled {
  cursor: default;
}

.overlay {
  position: absolute;
  box-sizing: border-box;
  outline: 2px solid #ff5d5d;
  outline-offset: -2px;
  background: rgba(255, 93, 93, 0.12);
  pointer-events: none;
}

.overlay.live {
  outline-style: dashed;
  background: rgba(60, 130, 255, 0.1);
  outline-color: #3c82ff;
}

.placeholder {
  color: #8a93a1;
  margin: 0;
  font-size: 14px;
}
</style>
