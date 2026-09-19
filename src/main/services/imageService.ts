import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ImageItem, ImportImageResult } from '../../shared/types'
import { sanitizeFileName } from './paths'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp'])

export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(extname(name).toLowerCase())
}

export function publicDir(root: string): string {
  return join(root, 'public')
}

/** 递归扫描 public/ 下的图片资源 */
export function listImages(root: string): ImageItem[] {
  const base = publicDir(root)
  if (!existsSync(base)) return []
  const items: ImageItem[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isFile() && isImageFile(entry.name)) {
        items.push(toImageItem(root, full))
      } else if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(full, depth + 1)
      }
    }
  }
  walk(base, 0)
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

function toImageItem(root: string, absPath: string): ImageItem {
  const base = publicDir(root)
  const relPath = absPath.slice(base.length + 1).replace(/\\/g, '/')
  const stat = statSync(absPath)
  const ext = extname(absPath).toLowerCase()
  const name = basename(absPath)
  return {
    relPath,
    name,
    ext: ext.slice(1),
    size: stat.size,
    lastModified: stat.mtimeMs,
    url: `media://local/${relPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')}`,
    refPath: `/${relPath}`
  }
}

/** 将本机图片复制进 public/images/（重名自动追加序号） */
export function importImage(root: string, srcPath: string): ImportImageResult {
  if (!isImageFile(srcPath)) throw new Error('仅支持常见图片格式（png/jpg/gif/webp/svg/avif/ico/bmp）')
  if (!existsSync(srcPath)) throw new Error('所选图片文件不存在')

  const targetDir = join(publicDir(root), 'images')
  mkdirSync(targetDir, { recursive: true })

  const ext = extname(srcPath).toLowerCase()
  let name = sanitizeFileName(basename(srcPath, ext)) + ext
  let counter = 1
  while (existsSync(join(targetDir, name))) {
    name = `${sanitizeFileName(basename(srcPath, ext))}-${counter}${ext}`
    counter++
  }

  const target = join(targetDir, name)
  copyFileSync(srcPath, target)
  const image = toImageItem(root, target)
  return {
    image,
    markdownRef: `![${basename(srcPath, ext)}](${image.refPath})`
  }
}
