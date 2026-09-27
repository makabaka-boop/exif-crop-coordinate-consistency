# EXIF 方向裁切工作室

零后端的本地图片裁切工具：Vue 3 + TypeScript + Canvas，全部计算在浏览器内完成，
图片与坐标永不离开本机。Docker Compose 以 nginx 静态托管单页应用。

## 功能

- 选择本地 PNG/JPEG（`createImageBitmap` 异步解码）
- 手动指定 EXIF 方向值 **1–8**（含镜像方向 2/4/5/7，不是单纯旋转）
- 在正向预览上以**整像素边界**拖出**半开矩形** `[x, x+w) × [y, y+h)`
- 导出：矩形四角经**逆变换**回到原图坐标系，按**原始像素、无缩放**输出正向 PNG
- 同一映射生成含原图坐标的 JSON（四角 + 可枚举的像素网格）
- 方向或图片变更时，旧异步解码与旧导出经**修订令牌**立即失效
- 已确认矩形改变同样作废旧导出：只有**图片、方向、矩形三者与当前确认状态
  完全一致**的产物才会下载，迟到编码不下载、不提示、不改写新状态
- 拖框期间收到指针取消（`pointercancel`）时撤销整次手势并恢复此前矩形，
  未完成手势绝不覆盖已确认裁切，未经确认的区域不开放下载
- 非法矩形（越界 / 尺寸 < 1×1 / 非整数边界）：保留当前图片，但禁用下载

## 坐标模型（`src/lib/geometry.ts`）

每个方向提供两套映射，反射轴不同：

| 用途 | 反射轴 | 说明 |
| --- | --- | --- |
| 像素索引 `forwardPixel` / `inversePixel` | `n - 1 - c` | 像素一一对应，无插值 |
| 连续坐标 `forwardPoint` / `inversePoint` | `n - c` | 半开矩形几何角点 |

导出像素 `(i,j)` 直接取 `src[inversePixel(x0+i, y0+j)]`，
因此**预览所见与导出文件逐像素一致**（浏览器测试有断言）。

JSON 的 `sourcePixelGrid` 用二维步长描述输出网格在原图中的位置：

```
srcX = originX + col*colStepX + row*rowStepX
srcY = originY + col*colStepY + row*rowStepY
```

转置方向（5–8）下输出列沿原图 y 轴移动，镜像方向步长为 -1。

## 开发

```bash
npm install
npm run dev        # Vite 开发服务器
npm test           # Vitest：八种方向 / 逆变换 / 边界，2×3 非对称彩色矩阵
npm run typecheck  # vue-tsc
npm run build      # 产物在 dist/
```

## 浏览器测试（Playwright）

```bash
npx playwright install chromium   # 首次需要
npx playwright test
```

覆盖一次完整流程：选图 → 方向 6 → 非法矩形（不给下载、图片保留）→
合法裁切 → 导出 PNG 与 JSON，并逐像素比对预览与文件内容；
另含镜像方向 2 的取对角落验证。

`race.spec.ts` 用**可控指针取消**与**延迟编码闸口**（`__testUtils`
仅测试注入，生产代码无该对象）和两张尺寸/配色均不同的非对称小图，断言：

1. 拖框期间取消指针 → 未完成手势不采纳，此前已确认矩形恢复，下载不开放；
2. 编码尚未结束时改矩形 → 旧区域文件不下载、旧成功提示不出现，
   新框导出的 PNG 像素与 JSON 网格逐项对应同一次裁切；
3. 编码期间换入另一张合法照片 → 旧编码放行后不下载、不改写新状态，
   新图完成拖框后导出按钮恢复可用，产物属于新图。

（无 root 权限的沙箱装不了 Chromium 系统库，需在本地或 CI 镜像中运行。）

## Docker Compose（零后端托管）

```bash
docker compose up --build
# 打开 http://localhost:8080
```

多阶段构建：Node 构建 `dist/` → nginx 仅托管静态文件，无任何后端进程。
