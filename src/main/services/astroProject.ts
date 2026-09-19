import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import type { CollectionInfo, ProjectInfo } from '../../shared/types'
import { toPosix } from './paths'
import { scanPosts, type CollectionDir } from './postService'

const ASTRO_CONFIG_NAMES = [
  'astro.config.ts',
  'astro.config.mts',
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.cjs'
]

const CONTENT_CONFIG_CANDIDATES = [
  'src/content.config.ts',
  'src/content.config.mts',
  'src/content.config.js',
  'src/content.config.mjs',
  'src/content/config.ts',
  'src/content/config.mts',
  'src/content/config.js',
  'src/content/config.mjs'
]

const MARKDOWN_EXTS = new Set(['.md', '.mdx'])
const MAX_WALK_DEPTH = 6

export interface ProjectValidation {
  ok: boolean
  reason?: string
}

/** 校验所选文件夹是否为 Astro 项目 */
export function validateAstroProject(root: string): ProjectValidation {
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    return { ok: false, reason: '所选文件夹中没有 package.json，请选择 Astro 项目的根目录' }
  }
  let deps: Record<string, string>
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch {
    return { ok: false, reason: 'package.json 解析失败，文件可能已损坏' }
  }
  if (!deps.astro) {
    return { ok: false, reason: 'package.json 中未找到 astro 依赖，这不是 Astro 项目' }
  }
  if (!ASTRO_CONFIG_NAMES.some((n) => existsSync(join(root, n)))) {
    return { ok: false, reason: '未找到 astro.config.* 配置文件' }
  }
  return { ok: true }
}

function detectPackageManager(root: string): ProjectInfo['packageManager'] {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  return 'unknown'
}

/** 从 astro.config.* 中正则提取 site 字段 */
function extractSite(root: string): string | undefined {
  for (const name of ASTRO_CONFIG_NAMES) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf-8')
      const m = text.match(/site\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/)
      if (m) return m[1]
    } catch {
      // 读取失败则跳过该配置文件
    }
  }
  return undefined
}

interface GlobEntry {
  name: string
  base?: string
}

/**
 * 从 content config（TS/JS）文本中提取各集合的 glob loader base。
 * 兼容两种写法：
 *   export const collections = { blog: defineCollection({ loader: glob({ base: './src/blog', pattern: ... }) }) }
 *   const blog = defineCollection({ schema: ... }); export const collections = { blog }
 */
function parseContentConfig(text: string): GlobEntry[] {
  const entries: GlobEntry[] = []
  const re = /([\w$]+)\s*[:=]\s*defineCollection\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const name = m[1]
    const openIdx = text.indexOf('(', m.index + m[0].length - 1)
    const inner = extractBalanced(text, openIdx)
    if (inner === null) continue
    const globMatch = inner.match(/glob\s*\(\s*\{([\s\S]*?)\}/)
    if (!globMatch) continue
    const base = globMatch[1].match(/base\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
    entries.push({ name, base })
  }
  return entries
}

/** 提取 text 中从 openIdx 处左括号开始配对的括号内内容（跳过字符串字面量） */
function extractBalanced(text: string, openIdx: number): string | null {
  if (openIdx < 0 || text[openIdx] !== '(') return null
  let depth = 0
  let quote: string | null = null
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return text.slice(openIdx + 1, i)
    }
  }
  return null
}

function dirHasMarkdown(dir: string): boolean {
  try {
    return walkForMarkdown(dir, 0)
  } catch {
    return false
  }
}

function walkForMarkdown(dir: string, depth: number): boolean {
  if (depth > MAX_WALK_DEPTH) return false
  let entries: import('node:fs').Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.isFile() && MARKDOWN_EXTS.has(extname(entry.name).toLowerCase())) return true
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      if (walkForMarkdown(join(dir, entry.name), depth + 1)) return true
    }
  }
  return false
}

/**
 * 发现博客的内容集合目录。
 * 优先解析 content config 中的 glob base，其次扫描 src/content/ 子目录，
 * 最后回退到 src/pages/（旧式页面型博客）。
 */
export function discoverCollections(root: string): CollectionDir[] {
  const found = new Map<string, string>() // dir(abs) -> name

  const add = (dir: string, name: string): void => {
    if (!dirHasMarkdown(dir)) return
    if (!found.has(dir)) found.set(dir, name)
  }

  // 1) content config 中的 glob loader
  for (const candidate of CONTENT_CONFIG_CANDIDATES) {
    const p = join(root, candidate)
    if (!existsSync(p)) continue
    try {
      const text = readFileSync(p, 'utf-8')
      for (const entry of parseContentConfig(text)) {
        const base = entry.base ?? './src/content'
        const dir = resolve(root, base)
        add(dir, entry.name)
      }
    } catch {
      // 配置读取失败时回退到目录扫描
    }
  }

  // 2) Astro 4 传统模式：src/content/<集合名>/
  const contentRoot = join(root, 'src', 'content')
  if (existsSync(contentRoot)) {
    try {
      for (const entry of readdirSync(contentRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          add(join(contentRoot, entry.name), entry.name)
        }
      }
      // src/content 根目录直接放文章且无子集合时，整体视为一个集合
      if (found.size === 0 && dirHasMarkdown(contentRoot)) {
        add(contentRoot, 'content')
      }
    } catch {
      // 目录读取失败则忽略
    }
  }

  // 3) 回退：src/pages 下的 markdown（旧式博客）
  if (found.size === 0) {
    const pagesRoot = join(root, 'src', 'pages')
    if (dirHasMarkdown(pagesRoot)) {
      add(pagesRoot, 'pages')
    }
  }

  return [...found.entries()]
    .map(([dir, name]) => ({ name, dir }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 读取项目完整信息（校验通过后调用） */
export function readProjectInfo(root: string): ProjectInfo {
  const pkgPath = join(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    name?: string
    description?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const astroDeps: Record<string, string> = {}
  for (const [name, version] of Object.entries(allDeps)) {
    if (name === 'astro' || name.startsWith('@astrojs/') || name.includes('astro')) {
      astroDeps[name] = version
    }
  }

  const collectionsDirs = discoverCollections(root)
  const posts = scanPosts(root, collectionsDirs)
  const collections: CollectionInfo[] = collectionsDirs.map((c) => {
    const items = posts.filter((p) => p.collection === c.name)
    return {
      name: c.name,
      dir: toPosix(c.dir),
      postCount: items.length,
      draftCount: items.filter((p) => p.draft).length
    }
  })

  const basename = root.split(/[\\/]/).filter(Boolean).pop() ?? root
  return {
    path: root,
    name: pkg.name || basename,
    astroVersion: allDeps.astro ?? '未知',
    site: extractSite(root),
    description: pkg.description,
    packageManager: detectPackageManager(root),
    astroDeps,
    collections,
    totalPosts: posts.length,
    draftCount: posts.filter((p) => p.draft).length
  }
}
