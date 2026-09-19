import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { LinkIssue } from '../../shared/types'
import { listMarkdownFiles, parsePostFile, type CollectionDir } from './postService'

/** 剥离围栏代码块与行内代码，避免把代码示例当链接检查 */
const CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
const INLINE_CODE_RE = /`[^`\n]+`/g
/** markdown 链接/图片：[text](target "title") 或 ![alt](target) */
const MD_REF_RE = /(!?)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g

const PAGE_EXTS = ['.md', '.mdx', '.astro']

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** 站内绝对路径链接：校验 src/pages 下是否存在对应页面路由 */
function pageExists(root: string, pathname: string): boolean {
  const base = join(root, 'src', 'pages', pathname.replace(/^\/+/, ''))
  if (PAGE_EXTS.some((ext) => isFile(base + ext))) return true
  return PAGE_EXTS.some((ext) => isFile(join(base, 'index' + ext)))
}

/**
 * 死链检查：扫描全部文章正文中的站内引用。
 * - 绝对路径图片（/images/a.png）→ 校验 public/ 下文件存在
 * - 绝对路径链接（/about/）→ 校验 src/pages 下页面存在
 * - 相对路径图片（./pic.png）→ 相对文章所在目录校验
 * - 外链、锚点、相对路径 md 互链不检查（记录为取舍）
 */
export function checkLinks(root: string, collections: CollectionDir[]): LinkIssue[] {
  const issues: LinkIssue[] = []
  const publicRoot = join(root, 'public')

  for (const c of collections) {
    for (const file of listMarkdownFiles(c.dir)) {
      const parsed = parsePostFile(file, root)
      if (!parsed) continue
      const content = parsed.body.replace(CODE_RE, ' ').replace(INLINE_CODE_RE, ' ')
      const postDir = dirname(file)

      for (const m of content.matchAll(MD_REF_RE)) {
        const isImage = m[1] === '!'
        const raw = m[2]
        if (!raw || raw.startsWith('#')) continue
        if (/^(https?:)?\/\//i.test(raw) || /^(mailto|tel):/i.test(raw)) continue

        const target = raw.split('#')[0].split('?')[0]
        if (!target) continue

        let reason: string | null = null
        if (target.startsWith('/')) {
          if (isImage) {
            if (!isFile(join(publicRoot, target.slice(1)))) reason = '图片不存在于 public/'
          } else if (!pageExists(root, target)) {
            reason = '站内页面不存在'
          }
        } else if (isImage) {
          if (!isFile(resolve(postDir, target))) reason = '相对路径图片不存在'
        } else {
          continue // 相对路径 md 互链暂不检查
        }

        if (reason) {
          issues.push({
            postId: parsed.meta.id,
            postTitle: parsed.meta.title,
            type: isImage ? 'image' : 'link',
            target,
            reason
          })
        }
      }
    }
  }

  return issues.sort((a, b) => a.postId.localeCompare(b.postId) || a.target.localeCompare(b.target))
}
