import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  BulkUpdatePatch,
  BulkUpdateResult,
  FrontmatterTemplate,
  GitFileStatus,
  NewPostInput,
  PostMeta
} from '@shared/types'

export interface CreatePostDialogInput {
  collection: string
  fileName: string
  title: string
  tags: string[]
  draft: boolean
  description: string
}

export const usePostsStore = defineStore('posts', () => {
  const posts = ref<PostMeta[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  // 外部修改推送（主进程文件监听）：git pull / 其他编辑器改动文章后自动更新列表
  let unsubscribeExternal: (() => void) | null = null
  function initExternalSync(): void {
    if (unsubscribeExternal) return
    unsubscribeExternal = window.api.onPostsChanged((list) => {
      posts.value = list
      loaded.value = true
      loading.value = false
    })
  }

  /** 布局卸载时调用，解除外部修改推送订阅 */
  function disposeExternalSync(): void {
    unsubscribeExternal?.()
    unsubscribeExternal = null
  }

  // ---- git 集成 ----
  const gitFiles = ref<Record<string, GitFileStatus>>({})
  const isGitRepo = ref(false)

  /** 读取文章文件的 git 状态（非 git 仓库时静默置空） */
  async function loadGitStatus(): Promise<void> {
    try {
      const res = await window.api.getGitStatus()
      isGitRepo.value = !!res
      gitFiles.value = res?.files ?? {}
    } catch {
      isGitRepo.value = false
      gitFiles.value = {}
    }
  }

  /** 提交指定文章文件后刷新 git 状态 */
  async function commitFiles(ids: string[], message: string): Promise<void> {
    await window.api.commitPosts(ids, message)
    await loadGitStatus()
  }

  // 筛选状态（侧边栏与列表页共享）
  const query = ref('')
  const tag = ref<string | null>(null)
  const draftOnly = ref(false)
  const collection = ref<string | null>(null)

  const tagCounts = computed(() => {
    const map = new Map<string, number>()
    for (const p of posts.value) {
      for (const t of p.tags) map.set(t, (map.get(t) ?? 0) + 1)
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  })

  const filtered = computed(() => {
    // 多词 AND：所有关键词都命中才算匹配（searchText 含标题/正文/标签/描述）
    const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return posts.value.filter((p) => {
      if (collection.value && p.collection !== collection.value) return false
      if (tag.value && !p.tags.includes(tag.value)) return false
      if (draftOnly.value && !p.draft) return false
      if (terms.length && !terms.every((t) => p.searchText.includes(t))) return false
      return true
    })
  })

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return
    loading.value = true
    try {
      posts.value = await window.api.listPosts()
      loaded.value = true
    } catch (err) {
      // 常见于应用启动瞬间尚未打开项目；置空即可，打开项目后会重新加载
      console.warn('加载文章列表失败:', (err as Error).message)
      posts.value = []
    } finally {
      loading.value = false
    }
  }

  function invalidate(): void {
    loaded.value = false
  }

  async function reload(): Promise<void> {
    invalidate()
    await load()
  }

  function clearFilters(): void {
    query.value = ''
    tag.value = null
    draftOnly.value = false
    collection.value = null
  }

  /** 依据现有文章推断的模板构建新文章 frontmatter 并创建文件，返回文章 id */
  async function createFromDialog(input: CreatePostDialogInput): Promise<string> {
    const template: FrontmatterTemplate = await window.api.getFrontmatterTemplate(input.collection)
    const today = new Date().toISOString().slice(0, 10)
    const fm: Record<string, unknown> = {}

    for (const key of template.keys) {
      if (template.dateKey && key === template.dateKey) {
        fm[key] = today
      } else if (template.titleKey && key === template.titleKey) {
        fm[key] = input.title
      } else if (template.tagsKey && key === template.tagsKey) {
        fm[key] = input.tags
      } else if (template.descriptionKey && key === template.descriptionKey) {
        fm[key] = input.description
      } else if (template.draftKey && key === template.draftKey) {
        fm[key] =
          template.draftKey.toLowerCase() === 'published' ? !input.draft : input.draft
      } else {
        const v = template.sample[key]
        if (v !== undefined) fm[key] = v
      }
    }
    // 模板推断不到任何键时给最小可用结构
    if (Object.keys(fm).length === 0) {
      fm['title'] = input.title
      fm['pubDate'] = today
      fm['tags'] = input.tags
      fm['draft'] = input.draft
    }

    const meta = await window.api.createPost({
      collection: input.collection,
      fileName: input.fileName,
      frontmatter: fm,
      body: `# ${input.title}\n\n从这里开始写作…\n`
    } satisfies NewPostInput)

    invalidate()
    return meta.id
  }

  async function remove(id: string): Promise<void> {
    await window.api.deletePost(id)
    invalidate()
  }

  /** 批量更新（草稿状态/标签追加），返回逐篇结果，由调用方汇总提示 */
  async function bulkUpdate(ids: string[], patch: BulkUpdatePatch): Promise<BulkUpdateResult[]> {
    const results = await window.api.bulkUpdatePosts(ids, patch)
    invalidate()
    return results
  }

  /** 批量删除：循环调用现有删除（走系统回收站），逐篇收集结果 */
  async function bulkRemove(ids: string[]): Promise<BulkUpdateResult[]> {
    const results: BulkUpdateResult[] = []
    for (const id of ids) {
      try {
        await window.api.deletePost(id)
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message })
      }
    }
    invalidate()
    return results
  }

  return {
    posts,
    loading,
    loaded,
    query,
    tag,
    draftOnly,
    collection,
    tagCounts,
    filtered,
    load,
    reload,
    invalidate,
    initExternalSync,
    disposeExternalSync,
    gitFiles,
    isGitRepo,
    loadGitStatus,
    commitFiles,
    clearFilters,
    createFromDialog,
    remove,
    bulkUpdate,
    bulkRemove
  }
})
