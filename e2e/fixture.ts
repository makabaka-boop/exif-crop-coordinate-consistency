/**
 * 浏览器测试在页面内现场生成非对称彩色小 PNG，无需任何网络图片资源，
 * 保持零后端。竞态验收使用两张尺寸、配色都不同的非对称小图，
 * 任何迟到结果写错状态都会立刻在像素层面暴露。
 *
 * 图 A（4×3，fixture.png）：
 *   红 绿 蓝 白
 *   青 品 黄 灰
 *   黑 橙 粉 棕
 *
 * 图 B（3×2，other.png）：使用不出现在图 A 中的颜色。
 */

export const SRC: number[][][] = [
  [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]],
  [[0, 255, 255], [255, 0, 255], [255, 255, 0], [128, 128, 128]],
  [[0, 0, 0], [255, 128, 0], [255, 128, 192], [128, 64, 0]]
]
export const SW = 4
export const SH = 3

export const SRC_B: number[][][] = [
  [[255, 99, 71], [255, 165, 0], [34, 139, 34]],
  [[138, 43, 226], [255, 192, 203], [0, 191, 255]]
]
export const SW_B = 3
export const SH_B = 2

/** 注入页面的测试工具：造 PNG File、读 canvas 像素、解码导出 Blob、延迟编码闸口。 */
export const browserSetup = `
const FIXTURES = {
  a: { name: 'fixture.png', grid: ${JSON.stringify(SRC)} },
  b: { name: 'other.png', grid: ${JSON.stringify(SRC_B)} }
};

async function makeSourceFile(which) {
  const fix = FIXTURES[which || 'a'];
  const grid = fix.grid;
  const h = grid.length, w = grid[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const off = (y * w + x) * 4;
    const [r, g, b] = grid[y][x];
    img.data[off] = r; img.data[off + 1] = g; img.data[off + 2] = b; img.data[off + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  return new File([blob], fix.name, { type: 'image/png' });
}

async function readCanvasRgba(canvas) {
  const ctx = canvas.getContext('2d');
  return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

async function decodeBlobRgba(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  bmp.close();
  return { width: c.width, height: c.height, data: Array.from(d) };
}

/**
 * 安装 PNG 编码延迟闸口：安装后 encodePng 在真正编码前停在 wait()，
 * 直到测试调用 release()。release 是一次性「全开」：之后的编码直接通过。
 * 用它稳定复现「编码尚未结束时用户改框/换图」的竞态。
 */
function installEncodeGate() {
  let open = false;
  let waiters = [];
  window.__testEncodeDelayGate = {
    wait() {
      if (open) return Promise.resolve();
      return new Promise(res => waiters.push(res));
    },
    release() {
      open = true;
      const pending = waiters;
      waiters = [];
      pending.forEach(res => res());
    },
    pendingCount() { return waiters.length; }
  };
}

window.__testUtils = { makeSourceFile, readCanvasRgba, decodeBlobRgba, installEncodeGate };
`
