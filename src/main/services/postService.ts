import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import matter from 'gray-matter'
import type {
  FrontmatterTemplate,
  NewPostInput,
  PostDetail,
  PostMeta,
  SavePostInput
} from '../../shared/types'
import { resolveWithin, sanitizeFileName, toPosix } from './paths'

export interface CollectionDir {
  name: string
  dir: string
}

const MARKDOWN_EXTS = new Set(['.md', '.mdx'])
const DATE_KEYS = [
  'pubDate',
  'pubDatetime',
  'date',
  'publishedDate',
  'publishedAt',
  'created',
  'createdAt'
]
const TITLE_KEYS = ['title', 'name']
const TAGS_KEYS = ['tags', 'keywords', 'categories']
const DRAFT_KEYS = ['draft', 'published']
const DESCRIPTION_KEYS = ['description', 'excerpt', 'summary']

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTS.has(extname(name).toLowerCase())
}

/** 递归列出目录下的全部 markdown 文件（绝对路径） */
export function listMarkdownFiles(dir: string): string[] {
  const result: string[] = []
  const walk = (d: string, depth: number): void => {
    if (depth > 6) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSafe(d)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isFile() && isMarkdownFile(entry.name)) result.push(full)
      else if (entry.isDirectory() && entry.name !== 'node_modules') walk(full, depth + 1)
    }
  }
  walk(dir, 0)
  return result
}

function readdirSafe(d: string): import('node:fs').Dirent[] {
  return readdirSync(d, { withFileTypes: true })
}

function toDateISO(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof value === 'number' && value > 10_000_000_000) return new Date(value).toISOString()
  return undefined
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
  }
  return []
}

function pickKey(data: Record<string, unknown>, keys: string[]): string | undefined {
  const lower = new Map(Object.keys(data).map((k) => [k.toLowerCase(), k]))
  for (const key of keys) {
    const actual = lower.get(key.toLowerCase())
    if (actual !== undefined) return actual
  }
  return undefined
}

/** 提取正文纯文本（粗略去 markdown 标记，用于全文搜索） */
function plainText(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`~_\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ParsedPost {
  meta: Omit<PostMeta, 'collection'>
  frontmatter: Record<string, unknown>
  body: string
}

/** 解析单个 markdown 文件为文章元数据 */
export function parsePostFile(absPath: string, projectRoot: string): ParsedPost | null {
  let raw: string
  try {
    raw = readFileSync(absPath, 'utf-8')
  } catch {
    return null
  }
  const parsed = matter(raw)
  const data = parsed.data as Record<string, unknown>
  const fileName = basename(absPath)
  const id = toPosix(absPath.slice(projectRoot.length + 1))

  const dateField = pickKey(data, DATE_KEYS)
  const date = dateField ? toDateISO(data[dateField]) : undefined
  const draftKey = pickKey(data, DRAFT_KEYS)
  let draft = false
  if (draftKey !== undefined) {
    draft =
      draftKey.toLowerCase() === 'published'
        ? data[draftKey] === false
        : data[draftKey] === true
  }

  const titleKey = pickKey(data, TITLE_KEYS)
  const rawTitle = titleKey && typeof data[titleKey] === 'string' ? (data[titleKey] as string) : ''
  const headingMatch = parsed.content.match(/^#\s+(.+)$/m)
  const title = rawTitle || (headingMatch ? headingMatch[1].trim() : fileName.replace(MD_EXT_RE, ''))

  const tagsKey = pickKey(data, TAGS_KEYS)
  const tags = tagsKey ? normalizeTags(data[tagsKey]) : []
  const descKey = pickKey(data, DESCRIPTION_KEYS)
  const description =
    descKey && typeof data[descKey] === 'string' ? (data[descKey] as string) : undefined

  const searchText = [title, tags.join(' '), description ?? '', plainText(parsed.content)]
    .join(' ')
    .toLowerCase()

  let updatedAt = 0
  try {
    updatedAt = statSync(absPath).mtimeMs
  } catch {
    updatedAt = Date.now()
  }

  return {
    meta: {
      id,
      fileName,
      title,
      dateField,
      date,
      description,
      tags,
      draft,
      searchText,
      updatedAt,
      bodyLength: parsed.content.length
    },
    frontmatter: data,
    body: parsed.content
  }
}

const MD_EXT_RE = /\.(md|mdx)$/i

/** 扫描全部集合的文章列表 */
export function scanPosts(root: string, collections: CollectionDir[]): PostMeta[] {
  const posts: PostMeta[] = []
  for (const c of collections) {
    for (const file of listMarkdownFiles(c.dir)) {
      const parsed = parsePostFile(file, root)
      if (parsed) posts.push({ ...parsed.meta, collection: c.name })
    }
  }
  return posts.sort(sortByDateDesc)
}

function sortByDateDesc(a: PostMeta, b: PostMeta): number {
  const da = a.date ? Date.parse(a.date) : a.updatedAt
  const db = b.date ? Date.parse(b.date) : b.updatedAt
  return db - da
}

/** 读取文章详情 */
export function readPost(root: string, id: string): PostDetail {
  const abs = resolveWithin(root, id)
  if (!isMarkdownFile(abs)) throw new Error('仅支持 .md / .mdx 文章文件')
  const parsed = parsePostFile(abs, root)
  if (!parsed) throw new Error(`文章读取失败: ${id}`)
  const collection = deriveCollectionName(root, id)
  return { ...parsed.meta, collection, frontmatter: parsed.frontmatter, body: parsed.body }
}

function deriveCollectionName(root: string, id: string): string {
  // id 相对根目录，形如 src/content/blog/foo.md → 集合名为 blog；src/pages/foo.md → pages
  const parts = id.split('/')
  const contentIdx = parts.indexOf('content')
  if (contentIdx >= 0 && parts.length > contentIdx + 2) return parts[contentIdx + 1]
  if (parts[0] === 'src' && parts[1] === 'pages') return 'pages'
  return parts.length > 1 ? parts[parts.length - 2] : 'content'
}

function stringifyPost(frontmatter: Record<string, unknown>, body: string): string {
  const normalizedBody = body.replace(/\r\n/g, '\n')
  if (Object.keys(frontmatter).length === 0) return normalizedBody
  return matter.stringify(normalizedBody, frontmatter, { language: 'yaml' })
}

/** 新建文章 */
export function createPost(root: string, input: NewPostInput, collections: CollectionDir[]): PostMeta {
  const collection = collections.find((c) => c.name === input.collection)
  if (!collection) throw new Error(`集合 "${input.collection}" 不存在`)
  let fileName = sanitizeFileName(input.fileName)
  if (!isMarkdownFile(fileName)) fileName += '.md'

  const abs = resolveWithin(collection.dir, fileName)
  if (existsSync(abs)) throw new Error(`文件 "${fileName}" 已存在，请换个文件名`)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, stringifyPost(input.frontmatter, input.body), 'utf-8')

  const parsed = parsePostFile(abs, root)
  if (!parsed) throw new Error('文章创建后读取失败')
  return { ...parsed.meta, collection: collection.name }
}

/** 保存文章（整体写回 frontmatter + 正文） */
export function savePost(root: string, input: SavePostInput): void {
  const abs = resolveWithin(root, input.id)
  if (!isMarkdownFile(abs)) throw new Error('仅支持 .md / .mdx 文章文件')
  if (!existsSync(abs)) throw new Error(`文章不存在: ${input.id}`)
  writeFileSync(abs, stringifyPost(input.frontmatter, input.body), 'utf-8')
}

/** 重命名文章文件 */
export function renamePost(root: string, id: string, newFileName: string): { id: string } {
  const abs = resolveWithin(root, id)
  if (!existsSync(abs)) throw new Error(`文章不存在: ${id}`)
  let fileName = sanitizeFileName(newFileName)
  if (!isMarkdownFile(fileName)) fileName += extname(abs) || '.md'
  const target = join(dirname(abs), fileName)
  if (target !== abs && existsSync(target)) throw new Error(`文件 "${fileName}" 已存在`)
  renameSync(abs, target)
  return { id: toPosix(target.slice(root.length + 1)) }
}

/** 删除文章（trash 由调用方注入，主进程传 shell.trashItem 以走系统回收站） */
export async function deletePost(
  root: string,
  id: string,
  trash: (path: string) => Promise<void>
): Promise<void> {
  const abs = resolveWithin(root, id)
  if (!existsSync(abs)) throw new Error(`文章不存在: ${id}`)
  await trash(abs)
}

/**
 * 依据集合内现有文章推断新建文章的 frontmatter 模板：
 * 统计键出现频率并借用最新文章的示例值，使新建文件天然兼容当前主题的 schema。
 */
export function buildFrontmatterTemplate(
  root: string,
  collectionName: string,
  collections: CollectionDir[]
): FrontmatterTemplate {
  const collection = collections.find((c) => c.name === collectionName)
  if (!collection) throw new Error(`集合 "${collectionName}" 不存在`)

  const files = listMarkdownFiles(collection.dir)
  const postsByKey: { keys: string[]; data: Record<string, unknown>; date: number }[] = []
  for (const file of files.slice(0, 30)) {
    const parsed = parsePostFile(file, root)
    if (parsed) {
      postsByKey.push({
        keys: Object.keys(parsed.frontmatter),
        data: parsed.frontmatter,
        date: parsed.meta.date ? Date.parse(parsed.meta.date) : parsed.meta.updatedAt
      })
    }
  }
  postsByKey.sort((a, b) => b.date - a.date)

  const counts = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  postsByKey.forEach((post) => {
    post.keys.forEach((key, idx) => {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (!firstSeen.has(key)) firstSeen.set(key, idx)
    })
  })
  const keys = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
    .map(([k]) => k)

  const newest = postsByKey[0]?.data ?? {}
  const sample: Record<string, unknown> = {}
  for (const key of keys) {
    const holder = postsByKey.find((p) => key in p.data)
    sample[key] = holder ? holder.data[key] : newest[key]
  }

  const dateKey =
    keys.find(
      (k) =>
        sample[k] instanceof Date ||
        DATE_KEYS.some((d) => d.toLowerCase() === k.toLowerCase()) ||
        /date|time/i.test(k)
    ) ?? undefined
  const titleKey = keys.find((k) => TITLE_KEYS.includes(k.toLowerCase()))
  const tagsKey = keys.find((k) => TAGS_KEYS.includes(k.toLowerCase()))
  const draftKey = keys.find((k) => DRAFT_KEYS.includes(k.toLowerCase()))
  const descriptionKey = keys.find((k) => DESCRIPTION_KEYS.includes(k.toLowerCase()))

  return { keys, sample, dateKey, titleKey, tagsKey, draftKey, descriptionKey }
}
