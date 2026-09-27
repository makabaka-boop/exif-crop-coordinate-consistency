import type { RgbaImage } from './image'
import { makeRgba, toImageData } from './image'

/**
 * 浏览器端 PNG/JPEG 解码。createImageBitmap 是异步的，
 * 调用方必须配合修订令牌在 await 后检查结果是否仍有效。
 */
export async function decodeImageFile(file: File): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法取得 2D Canvas 上下文')
    ctx.drawImage(bitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    // 拷贝一份，脱离 canvas 后端的复用缓冲
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data)
    }
  } finally {
    bitmap.close()
  }
}

/** 把光栅绘制到给定 canvas（1 个设备像素 = 1 个图像像素）。 */
export function paintToCanvas(img: RgbaImage, canvas: HTMLCanvasElement): void {
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法取得 2D Canvas 上下文')
  ctx.putImageData(toImageData(img), 0, 0)
}

/**
 * 可控延迟的测试闸口（仅浏览器自动化使用）：
 * 安装后 encodePng 会在真正编码前等待一个 release 信号，
 * 用它稳定复现「PNG 编码尚未结束时用户改变状态」的竞态。
 * 生产环境 window 上不存在该对象，行为零变化。
 */
interface EncodeDelayGate {
  wait(): Promise<void>
}

function encodeDelayGate(): EncodeDelayGate | undefined {
  return (
    globalThis as unknown as { __testEncodeDelayGate?: EncodeDelayGate }
  ).__testEncodeDelayGate
}

export function encodePng(img: RgbaImage): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法取得 2D Canvas 上下文')
  ctx.putImageData(toImageData(img), 0, 0)
  return (async () => {
    await encodeDelayGate()?.wait()
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('PNG 编码失败'))
      }, 'image/png')
    })
  })()
}

/** 浏览器内重新解码 PNG Blob（测试用于逐像素验证导出内容）。 */
export async function decodePngBlob(blob: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    const img = makeRgba(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法取得 2D Canvas 上下文')
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
    img.data.set(data)
    return img
  } finally {
    bitmap.close()
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 让浏览器有机会启动下载后再回收对象 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadJson(json: unknown, filename: string): void {
  const text = JSON.stringify(json, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  downloadBlob(blob, filename)
}
