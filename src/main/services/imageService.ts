import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ImageItem, ImportImageResult } from '../../shared/types'
import { pathExists, sanitizeFileName } from './paths'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp'])

export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(extname(name).toLowerCase())
}

export function publicDir(root: string): string {
  return join(root, 'public')
}

/** 递归扫描 public/ 下的图片资源 */
export async function listImages(root: string): Promise<ImageItem[]> {
  const base = publicDir(root)
  if (!(await pathExists(base))) return []
  const items: ImageItem[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isFile() && isImageFile(entry.name)) {
        items.push(await toImageItem(root, full))
      } else if (entry.isDirectory() && entry.name !== 'node_modules') {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(base, 0)
  return items.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

async function toImageItem(root: string, absPath: string): Promise<ImageItem> {
  const base = publicDir(root)
  const relPath = absPath.slice(base.length + 1).replace(/\\/g, '/')
  const st = await stat(absPath)
  const ext = extname(absPath).toLowerCase()
  const name = basename(absPath)
  return {
    relPath,
    name,
    ext: ext.slice(1),
    size: st.size,
    lastModified: st.mtimeMs,
    url: `media://local/${relPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/')}`,
    refPath: `/${relPath}`
  }
}

/** 将本机图片复制进 public/images/（重名自动追加序号） */
export async function importImage(root: string, srcPath: string): Promise<ImportImageResult> {
  if (!isImageFile(srcPath)) throw new Error('仅支持常见图片格式（png/jpg/gif/webp/svg/avif/ico/bmp）')
  if (!(await pathExists(srcPath))) throw new Error('所选图片文件不存在')

  const targetDir = join(publicDir(root), 'images')
  await mkdir(targetDir, { recursive: true })

  const ext = extname(srcPath).toLowerCase()
  const stem = sanitizeFileName(basename(srcPath, ext))
  let name = stem + ext
  let counter = 1
  while (await pathExists(join(targetDir, name))) {
    name = `${stem}-${counter}${ext}`
    counter++
  }

  const target = join(targetDir, name)
  await copyFile(srcPath, target)
  const image = await toImageItem(root, target)
  return {
    image,
    markdownRef: `![${basename(srcPath, ext)}](${image.refPath})`
  }
}
