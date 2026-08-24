import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** 书稿根目录（webapp/ 的上一级） */
const BOOK_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** 需要暴露给前端的静态资源目录 */
const ASSET_DIRS = ['images', 'images_original'] as const

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
}

export interface FigureEntry {
  id: string
  desc: string
  orig: string
  svg: string
}

/**
 * 扫描 images/ 得到插图清单。
 * 文件名形如 `fig-042_正四面体.svg`，同一 fig 编号的 .jpg/.png 与 .svg 配成一对。
 * 这一步取代了原来 gen_review.py 内嵌 manifest 的做法。
 */
export function scanFigures(): FigureEntry[] {
  const dir = path.join(BOOK_ROOT, 'images')
  if (!fs.existsSync(dir)) return []

  const byId = new Map<string, { desc: string; orig: string; svg: string }>()
  for (const file of fs.readdirSync(dir)) {
    const m = /^(fig-\d+)_?(.*)\.(jpg|jpeg|png|svg)$/i.exec(file)
    if (!m) continue
    const [, id, desc, rawExt] = m
    const rec = byId.get(id) ?? { desc: '', orig: '', svg: '' }
    if (rawExt.toLowerCase() === 'svg') rec.svg = file
    else rec.orig = file
    if (desc && !rec.desc) rec.desc = desc
    byId.set(id, rec)
  }

  return [...byId.entries()]
    .sort((a, b) => Number(a[0].slice(4)) - Number(b[0].slice(4)))
    .map(([id, rec]) => ({ id, ...rec }))
}

/**
 * 读取项目根目录下已有的 review_result.json。
 * 它是上一轮人工校对的成果，用来在浏览器本地进度为空时打底——
 * localStorage 按 origin 隔离，用 file:// 打开过的旧 review.html 攒下的记录
 * 本应用是读不到的，只能从这个文件恢复。
 */
export function readSavedReview(): unknown {
  const file = path.join(BOOK_ROOT, 'review_result.json')
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function copyDirInto(src: string, dst: string) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    if (entry.isDirectory()) copyDirInto(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

const VIRTUAL_ID = 'virtual:book-manifest'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * - dev：用中间件把 /images/** 与 /images_original/** 映射到书稿目录（它们在 Vite root 之外）
 * - build：把这两个目录整个拷进 dist/，产出可独立部署的静态站
 * - 两种模式下都提供 `virtual:book-manifest` 虚拟模块
 *
 * 设 BUILD_ASSETS=0 可跳过构建期拷贝（只想部署生成器、不带 29MB 插图时用）。
 */
export function bookAssets(): Plugin {
  return {
    name: 'book-assets',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },

    load(id) {
      if (id !== RESOLVED_ID) return null
      return [
        `export default ${JSON.stringify(scanFigures())}`,
        `export const savedReview = ${JSON.stringify(readSavedReview())}`,
      ].join('\n')
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0])
        const m = new RegExp(`^/(${ASSET_DIRS.join('|')})/(.+)$`).exec(url)
        if (!m) return next()

        // 防目录穿越：解析后的绝对路径必须仍在允许的资源目录内
        const baseDir = path.join(BOOK_ROOT, m[1])
        const filePath = path.resolve(baseDir, m[2])
        if (!filePath.startsWith(baseDir + path.sep)) {
          res.statusCode = 403
          return res.end('forbidden')
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next()

        res.setHeader('Content-Type', MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },

    closeBundle() {
      if (process.env.BUILD_ASSETS === '0') {
        this.warn('BUILD_ASSETS=0：已跳过插图拷贝，校对台在产物中将看不到图')
        return
      }
      for (const dir of ASSET_DIRS) {
        copyDirInto(path.join(BOOK_ROOT, dir), path.join(import.meta.dirname, '..', 'dist', dir))
      }
    },
  }
}
