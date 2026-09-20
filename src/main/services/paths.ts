import { access } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'

/** 文件/目录是否存在（异步，避免阻塞主进程事件循环） */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** 将 rel 解析为 root 内的绝对路径；越出根目录时抛错（防路径穿越） */
export function resolveWithin(root: string, rel: string): string {
  const abs = isAbsolute(rel) ? resolve(rel) : resolve(root, rel)
  const normalizedRoot = resolve(root)
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + sep)) {
    throw new Error(`路径越出项目根目录: ${rel}`)
  }
  return abs
}

/** 统一为 posix 风格分隔符（作为文章 id 使用） */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Windows/Unix 通用：去掉路径中的目录部分与非法字符，得到安全文件名 */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '')
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '')
  return cleaned || 'untitled'
}
