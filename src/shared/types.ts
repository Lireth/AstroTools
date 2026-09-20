/** 博客集合（content collection）信息 */
export interface CollectionInfo {
  /** 集合名，如 "blog"、"posts" */
  name: string
  /** 集合根目录（绝对路径） */
  dir: string
  /** 集合内 markdown 文章数（含草稿） */
  postCount: number
  /** 草稿数 */
  draftCount: number
}

/** 博客项目基础信息 */
export interface ProjectInfo {
  /** 项目根目录（绝对路径） */
  path: string
  /** 项目名（package.json name，缺省为文件夹名） */
  name: string
  /** Astro 版本号 */
  astroVersion: string
  /** astro.config 中配置的 site 字段 */
  site?: string
  /** package.json description */
  description?: string
  /** 依据 lockfile 判定的包管理器 */
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  /** astro 及相关集成/主题依赖 */
  astroDeps: Record<string, string>
  /** 发现的内容集合 */
  collections: CollectionInfo[]
  totalPosts: number
  draftCount: number
}

/** 文章列表条目（不含正文） */
export interface PostMeta {
  /** 唯一标识：相对项目根目录的路径（posix 分隔符） */
  id: string
  /** 所属集合名 */
  collection: string
  /** 文件名（含扩展名） */
  fileName: string
  title: string
  /** 日期字段名（pubDate/date/pubDatetime 等，随主题而异） */
  dateField?: string
  /** ISO 8601 日期字符串 */
  date?: string
  description?: string
  tags: string[]
  draft: boolean
  /** 正文纯文本摘要（用于全文搜索） */
  searchText: string
  /** 文件修改时间（毫秒时间戳） */
  updatedAt: number
  /** 正文字符数 */
  bodyLength: number
}

/** 文章详情（含正文） */
export interface PostDetail extends PostMeta {
  /** 完整 frontmatter（保持原始键序） */
  frontmatter: Record<string, unknown>
  /** markdown 正文（不含 frontmatter） */
  body: string
  /** 打开时文件的 mtime（外部修改冲突检测基线） */
  baseMtimeMs?: number
  /** 打开时文件的字节大小（外部修改冲突检测基线） */
  baseSize?: number
}

/** 新建文章入参 */
export interface NewPostInput {
  collection: string
  /** 文件名，如 my-first-post.md */
  fileName: string
  frontmatter: Record<string, unknown>
  body: string
}

/** 保存文章入参 */
export interface SavePostInput {
  id: string
  frontmatter: Record<string, unknown>
  body: string
  /** 上次读取/保存时的 mtime；与当前文件不一致时抛出外部修改冲突错误（external-modified: 前缀）。省略则跳过检测 */
  baseMtimeMs?: number
  /** 上次读取/保存时的字节大小，与 baseMtimeMs 配套使用 */
  baseSize?: number
}

/** 保存文章结果：写盘后的文件 stat，作为下一次保存的冲突检测基线 */
export interface SavePostResult {
  mtimeMs: number
  size: number
}

/** frontmatter 模板：依据现有文章推断的键序与示例值 */
export interface FrontmatterTemplate {
  /** 有序键列表 */
  keys: string[]
  /** 键 → 示例值 */
  sample: Record<string, unknown>
  /** 被识别为日期的键名 */
  dateKey?: string
  /** 被识别为标题的键名 */
  titleKey?: string
  /** 被识别为标签的键名 */
  tagsKey?: string
  /** 被识别为草稿标记的键名 */
  draftKey?: string
  /** 被识别为描述的键名 */
  descriptionKey?: string
}

/** 图片资源条目（public/ 下） */
export interface ImageItem {
  /** 相对 public/ 的路径（posix 分隔符），如 images/foo.png */
  relPath: string
  name: string
  ext: string
  /** 字节数 */
  size: number
  /** 毫秒时间戳 */
  lastModified: number
  /** 通过 media:// 协议访问的 URL */
  url: string
  /** 在 markdown 中的引用路径，如 /images/foo.png */
  refPath: string
}

/** dev server 运行状态 */
export interface DevServerState {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  /** 检测到的本地预览地址，如 http://localhost:4321/ */
  url?: string
  /** 最近一条日志或错误信息 */
  message?: string
  pid?: number
}

/** 生产构建（astro build）状态 */
export interface BuildState {
  status: 'idle' | 'building' | 'done' | 'error'
  /** 最近一条日志（成功含耗时与输出尾部，失败含错误尾部） */
  message?: string
  /** 最近一次成功构建的耗时（毫秒） */
  durationMs?: number
}

/** 导入图片结果 */
export interface ImportImageResult {
  image: ImageItem
  /** 建议的 markdown 引用，如 ![foo](/images/foo.png) */
  markdownRef: string
}

/** 应用主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 应用设置（settings.json 持久化） */
export interface AppSettings {
  recentProjects: string[]
  theme: ThemeMode
  /** 编辑器字号（px，12-24） */
  editorFontSize: number
}

/** git 文章状态（来自 git status porcelain 的简化映射） */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked'

/** 批量更新入参：undefined 的字段不修改 */
export interface BulkUpdatePatch {
  /** 目标草稿状态（服务端按每篇实际的 draft/published 键写入） */
  draft?: boolean
  /** 追加合并去重的标签 */
  addTags?: string[]
}

/** 批量操作逐篇结果 */
export interface BulkUpdateResult {
  id: string
  ok: boolean
  /** 失败/跳过原因 */
  error?: string
}

/** 死链检查问题条目 */
export interface LinkIssue {
  postId: string
  postTitle: string
  type: 'link' | 'image'
  /** 引用目标（已去除 #anchor 与 ?query） */
  target: string
  reason: string
}
