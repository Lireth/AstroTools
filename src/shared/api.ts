import type {
  AppSettings,
  BulkUpdatePatch,
  BulkUpdateResult,
  BuildState,
  DevServerState,
  FrontmatterTemplate,
  GitFileStatus,
  ImageItem,
  ImportImageResult,
  LinkIssue,
  NewPostInput,
  PostDetail,
  PostMeta,
  ProjectInfo,
  SavePostInput,
  SavePostResult
} from './types'

/** 渲染进程通过 window.api 访问的全部能力（preload contextBridge 暴露） */
export interface Api {
  /** 读取应用设置（最近项目 + 主题 + 编辑器字号） */
  getSettings(): Promise<AppSettings>
  /** 更新应用偏好（主题/编辑器字号），返回保存后的完整设置 */
  savePreferences(
    patch: Partial<Pick<AppSettings, 'theme' | 'editorFontSize'>>
  ): Promise<AppSettings>
  /** 从最近列表移除一条 */
  removeRecentProject(path: string): Promise<void>
  /** 弹出系统文件夹选择框，返回所选路径或 null */
  selectProjectFolder(): Promise<string | null>
  /** 打开（校验并读取）指定路径的 Astro 项目 */
  openProject(path: string): Promise<ProjectInfo>
  /** 重新读取当前项目信息 */
  refreshProject(): Promise<ProjectInfo>
  /** 获取主进程当前打开的项目（未打开时返回 null）。用于渲染层重载后恢复会话 */
  getCurrentProject(): Promise<ProjectInfo | null>
  /** 在系统资源管理器中显示当前项目目录 */
  showProjectInFolder(): Promise<void>
  /** 用系统默认浏览器打开外部链接（仅允许 http/https） */
  openExternal(url: string): Promise<void>

  /** 读取文章文件的 git 状态；项目不是 git 仓库时返回 null */
  getGitStatus(): Promise<{ files: Record<string, GitFileStatus> } | null>
  /** 提交指定文章文件（仅 stage 给定路径） */
  commitPosts(ids: string[], message: string): Promise<void>

  listPosts(): Promise<PostMeta[]>
  readPost(id: string): Promise<PostDetail>
  createPost(input: NewPostInput): Promise<PostMeta>
  /**
   * 保存文章（frontmatter + 正文）。携带 baseMtimeMs/baseSize 基线时，
   * 主进程先校验文件未被外部修改，冲突时抛出 EXTERNAL_MODIFIED_PREFIX 前缀错误；
   * 成功返回写盘后的 stat（作为下一次保存的基线）。
   */
  savePost(input: SavePostInput): Promise<SavePostResult>
  renamePost(id: string, newFileName: string): Promise<{ id: string }>
  deletePost(id: string): Promise<void>
  /** 批量更新文章（草稿状态/标签追加），返回逐篇结果，部分失败不回滚 */
  bulkUpdatePosts(ids: string[], patch: BulkUpdatePatch): Promise<BulkUpdateResult[]>
  /** 死链检查：站内链接与图片引用有效性 */
  checkLinks(): Promise<LinkIssue[]>
  /** 依据集合现有文章推断新建文章的 frontmatter 模板 */
  getFrontmatterTemplate(collection: string): Promise<FrontmatterTemplate>

  listImages(): Promise<ImageItem[]>
  /** 弹出文件选择框导入一张或多张图片到 public/ */
  importImages(): Promise<ImportImageResult[]>
  /** 保存编辑器粘贴/拖入的图片二进制到 public/images/，返回 markdown 引用 */
  saveImage(name: string, mime: string, data: Uint8Array): Promise<ImportImageResult>
  /** 删除图片（移入系统回收站）。relPath 相对 public/ */
  deleteImage(relPath: string): Promise<void>
  /** 查找 public/ 下未被任何源码/文章引用的图片 */
  findUnusedImages(): Promise<string[]>

  startDevServer(): Promise<void>
  stopDevServer(): Promise<void>
  /** 订阅 dev server 状态推送，返回取消订阅函数 */
  onDevServerState(cb: (state: DevServerState) => void): () => void

  /** 启动 astro build 生产构建（同一时刻仅允许一个） */
  startBuild(): Promise<void>
  /** 取消进行中的构建 */
  stopBuild(): Promise<void>
  /** 订阅构建状态推送，返回取消订阅函数 */
  onBuildState(cb: (state: BuildState) => void): () => void

  /** 订阅文章列表推送（主进程文件监听检测到外部修改时），返回取消订阅函数 */
  onPostsChanged(cb: (posts: PostMeta[]) => void): () => void

  /** 主进程请求关闭确认（窗口 close 被拦截后触发），返回取消订阅函数 */
  onAppRequestClose(cb: () => void): () => void
  /** 确认可以关闭窗口（无脏状态或用户已确认） */
  confirmAppClose(): Promise<void>
}
