import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { FrontmatterTemplate, NewPostInput, PostMeta } from '@shared/types'

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
    const q = query.value.trim().toLowerCase()
    return posts.value.filter((p) => {
      if (collection.value && p.collection !== collection.value) return false
      if (tag.value && !p.tags.includes(tag.value)) return false
      if (draftOnly.value && !p.draft) return false
      if (q && !p.searchText.includes(q)) return false
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
    clearFilters,
    createFromDialog,
    remove
  }
})
