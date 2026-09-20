import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { ImageItem, ImportImageResult } from '../../shared/types'
import { pathExists, sanitizeFileName } from './paths'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp'])
/** 剪贴板/拖入图片无文件名扩展名时，按 MIME 类型推断扩展名 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif'
}
/** 查找未引用图片时扫描的源码文件类型 */
const REFERENCE_TEXT_EXTS = new Set([
  '.md', '.mdx', '.astro', '.ts', '.mts', '.js', '.mjs', '.css', '.scss', '.vue', '.json', '.html'
])
const ASTRO_CONFIG_NAMES = ['astro.config.ts', 'astro.config.mts', 'astro.config.mjs', 'astro.config.js']

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

/** 在 targetDir 内为 stem+ext 找一个不重名的目标路径（重名追加序号） */
async function resolveNewImageTarget(targetDir: string, stem: string, ext: string): Promise<string> {
  let name = stem + ext
  let counter = 1
  while (await pathExists(join(targetDir, name))) {
    name = `${stem}-${counter}${ext}`
    counter++
  }
  return join(targetDir, name)
}

/** 将本机图片复制进 public/images/（重名自动追加序号） */
export async function importImage(root: string, srcPath: string): Promise<ImportImageResult> {
  if (!isImageFile(srcPath)) throw new Error('仅支持常见图片格式（png/jpg/gif/webp/svg/avif/ico/bmp）')
  if (!(await pathExists(srcPath))) throw new Error('所选图片文件不存在')

  const targetDir = join(publicDir(root), 'images')
  await mkdir(targetDir, { recursive: true })

  const ext = extname(srcPath).toLowerCase()
  const stem = sanitizeFileName(basename(srcPath, ext))
  const target = await resolveNewImageTarget(targetDir, stem, ext)

  await copyFile(srcPath, target)
  const image = await toImageItem(root, target)
  return {
    image,
    markdownRef: `![${stem}](${image.refPath})`
  }
}

/**
 * 保存编辑器粘贴/拖入的图片二进制到 public/images/（重名自动追加序号）。
 * 文件名缺失扩展名时按 MIME 类型推断；返回 markdown 引用供插入光标处。
 */
export async function saveImage(
  root: string,
  originalName: string,
  mime: string,
  data: Uint8Array
): Promise<ImportImageResult> {
  const rawName = basename(originalName).trim() || 'pasted-image'
  let ext = extname(rawName).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    ext = '.' + (MIME_EXT[mime.toLowerCase().split(';')[0]] ?? '')
    if (ext === '.') {
      throw new Error('无法识别图片格式（仅支持 png/jpg/gif/webp/svg）')
    }
  }
  const stem = sanitizeFileName(rawName.replace(/\.[^.]*$/, ''))
  const targetDir = join(publicDir(root), 'images')
  await mkdir(targetDir, { recursive: true })
  const target = await resolveNewImageTarget(targetDir, stem, ext)

  await writeFile(target, data)
  const image = await toImageItem(root, target)
  return {
    image,
    markdownRef: `![${stem}](${image.refPath})`
  }
}

/** 删除图片（trash 由调用方注入，走系统回收站）。relPath 相对 public/，防路径穿越 */
export async function deleteImage(
  root: string,
  relPath: string,
  trash: (path: string) => Promise<void>
): Promise<void> {
  const publicRoot = resolve(publicDir(root))
  const abs = resolve(publicRoot, relPath)
  if (!abs.startsWith(publicRoot + sep)) throw new Error('非法的图片路径')
  if (!(await pathExists(abs))) throw new Error('图片不存在')
  await trash(abs)
}

/** 收集 src/ 与根配置文件中可能引用图片的文本（拼接为一个大字符串） */
async function collectReferenceText(root: string): Promise<string> {
  const chunks: string[] = []
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
      if (entry.isFile() && REFERENCE_TEXT_EXTS.has(extname(entry.name).toLowerCase())) {
        try {
          chunks.push(await readFile(full, 'utf-8'))
        } catch {
          // 读取失败即跳过该文件
        }
      } else if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(join(root, 'src'), 0)
  for (const name of ASTRO_CONFIG_NAMES) {
    const p = join(root, name)
    if (!(await pathExists(p))) continue
    try {
      chunks.push(await readFile(p, 'utf-8'))
    } catch {
      // 忽略
    }
  }
  return chunks.join('\n')
}

/**
 * 找出 public/ 下未被任何源码/文章引用的图片（返回相对 public/ 的路径）。
 * 判定保守：只要任意源码文本含该相对路径即视为已引用，避免误删主题引用的资源。
 */
export async function findUnusedImages(root: string): Promise<string[]> {
  const text = await collectReferenceText(root)
  const images = await listImages(root)
  return images.filter((img) => !text.includes(img.relPath)).map((img) => img.relPath)
}
