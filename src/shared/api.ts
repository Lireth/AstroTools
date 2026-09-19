import type {
  DevServerState,
  FrontmatterTemplate,
  ImageItem,
  ImportImageResult,
  NewPostInput,
  PostDetail,
  PostMeta,
  ProjectInfo,
  SavePostInput
} from './types'

/** 渲染进程通过 window.api 访问的全部能力（preload contextBridge 暴露） */
export interface Api {
  /** 读取最近项目列表 */
  getSettings(): Promise<{ recentProjects: string[] }>
  /** 从最近列表移除一条 */
  removeRecentProject(path: string): Promise<void>
  /** 弹出系统文件夹选择框，返回所选路径或 null */
  selectProjectFolder(): Promise<string | null>
  /** 打开（校验并读取）指定路径的 Astro 项目 */
  openProject(path: string): Promise<ProjectInfo>
  /** 重新读取当前项目信息 */
  refreshProject(): Promise<ProjectInfo>
  /** 在系统资源管理器中显示当前项目目录 */
  showProjectInFolder(): Promise<void>
  /** 用系统默认浏览器打开外部链接（仅允许 http/https） */
  openExternal(url: string): Promise<void>

  listPosts(): Promise<PostMeta[]>
  readPost(id: string): Promise<PostDetail>
  createPost(input: NewPostInput): Promise<PostMeta>
  savePost(input: SavePostInput): Promise<void>
  renamePost(id: string, newFileName: string): Promise<{ id: string }>
  deletePost(id: string): Promise<void>
  /** 依据集合现有文章推断新建文章的 frontmatter 模板 */
  getFrontmatterTemplate(collection: string): Promise<FrontmatterTemplate>

  listImages(): Promise<ImageItem[]>
  /** 弹出文件选择框导入一张图片到 public/ */
  importImage(): Promise<ImportImageResult | null>

  startDevServer(): Promise<void>
  stopDevServer(): Promise<void>
  /** 订阅 dev server 状态推送，返回取消订阅函数 */
  onDevServerState(cb: (state: DevServerState) => void): () => void
}
