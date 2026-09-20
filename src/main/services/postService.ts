import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import matter from 'gray-matter'
import { dump as yamlDump, JSON_SCHEMA, load as yamlLoad } from 'js-yaml'
import type {
  BulkUpdatePatch,
  BulkUpdateResult,
  FrontmatterTemplate,
  NewPostInput,
  PostDetail,
  PostMeta,
  SavePostInput
} from '../../shared/types'
import { pathExists, resolveWithin, sanitizeFileName, toPosix } from './paths'

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

/**
 * frontmatter 专用 YAML 引擎（保存保真）：
 * 采用 YAML 1.2 JSON schema —— 日期一律按字符串读入与写出，
 * `pubDate: 2024-05-01` 在"解析 → 保存"往返后保持原样，不会被改写成
 * 带时刻的 ISO 长串；同时规避默认 schema 把 Date dump 成 `...T00:00:00.000Z` 的漂移。
 */
const yamlEngine = {
  parse: (input: string): object => yamlLoad(input, { schema: JSON_SCHEMA }) as object,
  // lineWidth 必须为 -1（js-yaml 5 中 0 表示"宽度为 0"，会把含空格的值折叠成块标量）
  stringify: (data: object): string =>
    yamlDump(data, { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true })
}

const MATTER_OPTIONS = { engines: { yaml: yamlEngine } }

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTS.has(extname(name).toLowerCase())
}

/** 递归列出目录下的全部 markdown 文件（绝对路径） */
export async function listMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 6) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(d, entry.name)
      if (entry.isFile() && isMarkdownFile(entry.name)) result.push(full)
      else if (entry.isDirectory() && entry.name !== 'node_modules') await walk(full, depth + 1)
    }
  }
  await walk(dir, 0)
  return result
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
export async function parsePostFile(
  absPath: string,
  projectRoot: string
): Promise<ParsedPost | null> {
  let raw: string
  try {
    raw = await readFile(absPath, 'utf-8')
  } catch {
    return null
  }
  const parsed = matter(raw, MATTER_OPTIONS)
  const data = parsed.data as Record<string, unknown>
  const fileName = basename(absPath)
  const id = toPosix(absPath.slice(projectRoot.length + 1))

  const dateField = pickKey(data, DATE_KEYS)
  const date = dateField ? toDateISO(data[dateField]) : undefined
  const draftKey = pickKey(data, DRAFT_KEYS)
  let draft = false
  if (draftKey !== undefined) {
    draft =
      draftKey.toLowerCase() === 'published' ? data[draftKey] === false : data[draftKey] === true
  }

  const titleKey = pickKey(data, TITLE_KEYS)
  const rawTitle = titleKey && typeof data[titleKey] === 'string' ? (data[titleKey] as string) : ''
  const headingMatch = parsed.content.match(/^#\s+(.+)$/m)
  const title =
    rawTitle || (headingMatch ? headingMatch[1].trim() : fileName.replace(MD_EXT_RE, ''))

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
    updatedAt = (await stat(absPath)).mtimeMs
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

// ---- 解析缓存：文件 mtime+size 未变化时直接复用上次解析结果，避免每次全量重扫 ----
interface ParseCacheEntry {
  mtimeMs: number
  size: number
  parsed: ParsedPost | null
}
const parseCache = new Map<string, ParseCacheEntry>()

// ---- frontmatter 模板缓存：键 `${root}::${collection}`，任何写操作后整体失效 ----
const templateCache = new Map<string, FrontmatterTemplate>()

/** 带缓存的文件解析 */
export async function parsePostFileCached(
  absPath: string,
  projectRoot: string
): Promise<ParsedPost | null> {
  let mtimeMs = 0
  let size = 0
  try {
    const s = await stat(absPath)
    mtimeMs = s.mtimeMs
    size = s.size
  } catch {
    parseCache.delete(absPath)
    return null
  }
  const hit = parseCache.get(absPath)
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.parsed
  const parsed = await parsePostFile(absPath, projectRoot)
  parseCache.set(absPath, { mtimeMs, size, parsed })
  return parsed
}

/** 清理解析与模板缓存（root 省略时全清；切换/关闭项目时调用） */
export function clearPostCache(root?: string): void {
  if (root === undefined) {
    parseCache.clear()
    templateCache.clear()
    return
  }
  const sepPrefix = root.endsWith(sep) ? root : root + sep
  const posixPrefix = sepPrefix.replace(/\\/g, '/')
  for (const key of parseCache.keys()) {
    if (key.startsWith(sepPrefix) || key.startsWith(posixPrefix)) parseCache.delete(key)
  }
  for (const key of templateCache.keys()) {
    if (key.startsWith(root + '::')) templateCache.delete(key)
  }
}

/** 扫描全部集合的文章列表 */
export async function scanPosts(root: string, collections: CollectionDir[]): Promise<PostMeta[]> {
  const posts: PostMeta[] = []
  const seen = new Set<string>()
  for (const c of collections) {
    for (const file of await listMarkdownFiles(c.dir)) {
      seen.add(file)
      const parsed = await parsePostFileCached(file, root)
      if (parsed) posts.push({ ...parsed.meta, collection: c.name })
    }
  }
  // 淘汰已删除文件的缓存条目，避免长期驻留增长
  if (parseCache.size > seen.size) {
    for (const key of parseCache.keys()) {
      if (!seen.has(key)) parseCache.delete(key)
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
export async function readPost(root: string, id: string): Promise<PostDetail> {
  const abs = resolveWithin(root, id)
  if (!isMarkdownFile(abs)) throw new Error('仅支持 .md / .mdx 文章文件')
  const parsed = await parsePostFileCached(abs, root)
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
  return matter.stringify(normalizedBody, frontmatter, { language: 'yaml', ...MATTER_OPTIONS })
}

// ---- 原子写：先写同目录临时文件再 rename 覆盖目标，避免写入中途崩溃/断电导致文章文件截断 ----
let tmpSeq = 0
async function atomicWriteFile(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.${process.pid}.${tmpSeq++}.tmp`
  try {
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, abs)
  } catch (err) {
    try {
      await unlink(tmp)
    } catch {
      // 临时文件可能尚未创建成功，忽略
    }
    throw err
  }
}

/** 新建文章 */
export async function createPost(
  root: string,
  input: NewPostInput,
  collections: CollectionDir[]
): Promise<PostMeta> {
  const collection = collections.find((c) => c.name === input.collection)
  if (!collection) throw new Error(`集合 "${input.collection}" 不存在`)
  let fileName = sanitizeFileName(input.fileName)
  if (!isMarkdownFile(fileName)) fileName += '.md'

  const abs = resolveWithin(collection.dir, fileName)
  if (await pathExists(abs)) throw new Error(`文件 "${fileName}" 已存在，请换个文件名`)
  await mkdir(dirname(abs), { recursive: true })
  await atomicWriteFile(abs, stringifyPost(input.frontmatter, input.body))
  parseCache.delete(abs)
  templateCache.clear()

  const parsed = await parsePostFileCached(abs, root)
  if (!parsed) throw new Error('文章创建后读取失败')
  return { ...parsed.meta, collection: collection.name }
}

/** 保存文章（整体写回 frontmatter + 正文） */
export async function savePost(root: string, input: SavePostInput): Promise<void> {
  const abs = resolveWithin(root, input.id)
  if (!isMarkdownFile(abs)) throw new Error('仅支持 .md / .mdx 文章文件')
  if (!(await pathExists(abs))) throw new Error(`文章不存在: ${input.id}`)
  await atomicWriteFile(abs, stringifyPost(input.frontmatter, input.body))
  parseCache.delete(abs)
  templateCache.clear()
}

/** 重命名文章文件 */
export async function renamePost(
  root: string,
  id: string,
  newFileName: string
): Promise<{ id: string }> {
  const abs = resolveWithin(root, id)
  if (!(await pathExists(abs))) throw new Error(`文章不存在: ${id}`)
  let fileName = sanitizeFileName(newFileName)
  if (!isMarkdownFile(fileName)) fileName += extname(abs) || '.md'
  const target = join(dirname(abs), fileName)
  if (target !== abs && (await pathExists(target))) throw new Error(`文件 "${fileName}" 已存在`)
  await rename(abs, target)
  parseCache.delete(abs)
  templateCache.clear()
  return { id: toPosix(target.slice(root.length + 1)) }
}

/** 删除文章（trash 由调用方注入，主进程传 shell.trashItem 以走系统回收站） */
export async function deletePost(
  root: string,
  id: string,
  trash: (path: string) => Promise<void>
): Promise<void> {
  const abs = resolveWithin(root, id)
  if (!(await pathExists(abs))) throw new Error(`文章不存在: ${id}`)
  await trash(abs)
  parseCache.delete(abs)
  templateCache.clear()
}

/**
 * 批量更新文章（草稿状态/标签追加）。逐篇独立处理：单篇失败不中断整体；
 * 某篇探测不到对应键时跳过并注明原因，不擅自给不认识 schema 的文章加键。
 */
export async function bulkUpdatePosts(
  root: string,
  ids: string[],
  patch: BulkUpdatePatch
): Promise<BulkUpdateResult[]> {
  return Promise.all(
    ids.map(async (id) => {
      try {
        const reason = await applyBulkPatch(root, id, patch)
        return reason ? { id, ok: false, error: reason } : { id, ok: true }
      } catch (err) {
        return { id, ok: false, error: (err as Error).message }
      }
    })
  )
}

/** 对单篇文章应用 patch。成功返回 null，失败/跳过返回原因。 */
async function applyBulkPatch(
  root: string,
  id: string,
  patch: BulkUpdatePatch
): Promise<string | null> {
  const abs = resolveWithin(root, id)
  if (!isMarkdownFile(abs)) return '仅支持 .md / .mdx 文章文件'
  if (!(await pathExists(abs))) return '文件不存在（可能已被移动或删除）'
  const parsed = await parsePostFileCached(abs, root)
  if (!parsed) return '文章解析失败'

  const fm = { ...parsed.frontmatter }
  let changed = false

  if (patch.draft !== undefined) {
    const draftKey = pickKey(fm, DRAFT_KEYS)
    if (!draftKey) return '未识别草稿标记键（draft/published），已跳过'
    fm[draftKey] = draftKey.toLowerCase() === 'published' ? !patch.draft : patch.draft
    changed = true
  }

  if (patch.addTags && patch.addTags.length > 0) {
    const tagsKey = pickKey(fm, TAGS_KEYS)
    if (!tagsKey) return '未识别标签键（tags/keywords/categories），已跳过'
    const before = normalizeTags(fm[tagsKey])
    const merged = [...new Set([...before, ...patch.addTags])]
    if (merged.some((t, i) => t !== before[i]) || merged.length !== before.length) {
      fm[tagsKey] = merged
      changed = true
    }
  }

  if (changed) {
    await atomicWriteFile(abs, stringifyPost(fm, parsed.body))
    parseCache.delete(abs)
    templateCache.clear()
  }
  return null
}

/**
 * 依据集合内现有文章推断新建文章的 frontmatter 模板：
 * 统计键出现频率并借用最新文章的示例值，使新建文件天然兼容当前主题的 schema。
 */
export async function buildFrontmatterTemplate(
  root: string,
  collectionName: string,
  collections: CollectionDir[]
): Promise<FrontmatterTemplate> {
  const cacheKey = root + '::' + collectionName
  const cached = templateCache.get(cacheKey)
  if (cached) return cached

  const collection = collections.find((c) => c.name === collectionName)
  if (!collection) throw new Error(`集合 "${collectionName}" 不存在`)

  const files = await listMarkdownFiles(collection.dir)
  const postsByKey: { keys: string[]; data: Record<string, unknown>; date: number }[] = []
  await Promise.all(
    files.slice(0, 30).map(async (file) => {
      const parsed = await parsePostFileCached(file, root)
      if (parsed) {
        postsByKey.push({
          keys: Object.keys(parsed.frontmatter),
          data: parsed.frontmatter,
          date: parsed.meta.date ? Date.parse(parsed.meta.date) : parsed.meta.updatedAt
        })
      }
    })
  )
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

  const template: FrontmatterTemplate = {
    keys,
    sample,
    dateKey,
    titleKey,
    tagsKey,
    draftKey,
    descriptionKey
  }
  templateCache.set(cacheKey, template)
  return template
}
