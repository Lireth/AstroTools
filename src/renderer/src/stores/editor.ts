import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { FrontmatterTemplate, PostDetail } from '@shared/types'
import { usePostsStore } from './posts'

export interface ExtraField {
  key: string
  value: string
}

const TITLE_KEYS = ['title', 'name']
const TAGS_KEYS = ['tags', 'keywords', 'categories']
const DRAFT_KEYS = ['draft', 'published']
const DESCRIPTION_KEYS = ['description', 'excerpt', 'summary']
const DATE_HINT_RE = /date|time|day/i

/** 其他字段值解析：合法 JSON 则转为结构化值，否则按字符串处理 */
function parseExtraValue(text: string): unknown {
  const t = text.trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return text
  }
}

function extraValueText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v, null, 2)
  return String(v)
}

export const useEditorStore = defineStore('editor', () => {
  // shallowRef：detail 来自 IPC（必须保持可克隆的普通对象），避免响应式 Proxy 混入 frontmatter
  const detail = shallowRef<PostDetail | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)

  // 表单状态
  const body = ref('')
  const title = ref('')
  const dateStr = ref('')
  const tags = ref<string[]>([])
  const description = ref('')
  const draft = ref(false)
  const fileName = ref('')
  const extras = ref<ExtraField[]>([])

  // frontmatter 键名映射（随主题而异，打开时按实际文件/模板推断）
  let titleKey = 'title'
  let dateKey = 'pubDate'
  let tagsKey = 'tags'
  let descriptionKey = 'description'
  let draftKey = 'draft'
  let originalFm: Record<string, unknown> = {}
  const touched = { title: false, date: false, tags: false, description: false, draft: false }

  const wordCount = computed(() => body.value.replace(/\s/g, '').length)

  function deriveKeys(fm: Record<string, unknown>, template: FrontmatterTemplate): void {
    const findKey = (names: string[], pattern?: RegExp): string | undefined => {
      const fmKeys = Object.keys(fm)
      for (const name of names) {
        const hit = fmKeys.find((k) => k.toLowerCase() === name)
        if (hit) return hit
      }
      for (const name of names) {
        const hit = template.keys.find((k) => k.toLowerCase() === name)
        if (hit) return hit
      }
      if (pattern) {
        const hit = fmKeys.find((k) => pattern.test(k)) ?? template.keys.find((k) => pattern.test(k))
        if (hit) return hit
      }
      return undefined
    }

    titleKey = findKey(TITLE_KEYS) ?? 'title'
    dateKey = detail.value?.dateField ?? template.dateKey ?? findKey([], DATE_HINT_RE) ?? 'pubDate'
    tagsKey = findKey(TAGS_KEYS) ?? 'tags'
    descriptionKey = findKey(DESCRIPTION_KEYS) ?? 'description'
    draftKey = findKey(DRAFT_KEYS) ?? 'draft'
  }

  async function open(id: string): Promise<void> {
    loading.value = true
    dirty.value = false
    try {
      detail.value = await window.api.readPost(id)
      const fm = detail.value.frontmatter
      const template = await window.api.getFrontmatterTemplate(detail.value.collection)
      deriveKeys(fm, template)
      originalFm = fm

      body.value = detail.value.body
      fileName.value = detail.value.fileName
      title.value = typeof fm[titleKey] === 'string' ? (fm[titleKey] as string) : detail.value.title
      dateStr.value = detail.value.date ? detail.value.date.slice(0, 10) : ''
      tags.value = [...detail.value.tags]
      description.value =
        typeof fm[descriptionKey] === 'string' ? (fm[descriptionKey] as string) : ''
      draft.value = detail.value.draft

      const known = new Set(
        [titleKey, dateKey, tagsKey, descriptionKey, draftKey].map((k) => k.toLowerCase())
      )
      extras.value = Object.entries(fm)
        .filter(([k]) => !known.has(k.toLowerCase()))
        .map(([k, v]) => ({ key: k, value: extraValueText(v) }))
    } finally {
      loading.value = false
    }
  }

  function markDirty(): void {
    dirty.value = true
  }

  function markTouched(field: keyof typeof touched): void {
    touched[field] = true
    dirty.value = true
  }

  async function save(): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      const fm: Record<string, unknown> = { ...originalFm }
      const write = (key: string, value: unknown, isTouched: boolean): void => {
        if (Object.keys(originalFm).some((k) => k.toLowerCase() === key.toLowerCase()) || isTouched) {
          fm[key] = value
        }
      }

      write(titleKey, title.value.trim(), touched.title)
      if (dateStr.value) write(dateKey, dateStr.value, touched.date)
      // 展开为数组浅拷贝：ref 内的数组是响应式 Proxy，无法结构化克隆过 IPC
      write(tagsKey, [...tags.value], touched.tags)
      write(descriptionKey, description.value, touched.description)
      write(
        draftKey,
        draftKey.toLowerCase() === 'published' ? !draft.value : draft.value,
        touched.draft
      )

      // 其他字段整体按面板内容重建（键名大小写以面板为准）
      for (const [k] of Object.entries(fm)) {
        if (!extras.value.some((f) => f.key === k)) {
          const known = [titleKey, dateKey, tagsKey, descriptionKey, draftKey]
          if (!known.includes(k)) delete fm[k]
        }
      }
      for (const f of extras.value) {
        const k = f.key.trim()
        if (k) fm[k] = parseExtraValue(f.value)
      }

      await window.api.savePost({ id: detail.value.id, frontmatter: fm, body: body.value })
      dirty.value = false
      usePostsStore().invalidate()
    } finally {
      saving.value = false
    }
  }

  async function rename(): Promise<void> {
    if (!detail.value) return
    if (dirty.value) throw new Error('请先保存修改，再重命名文件')
    const res = await window.api.renamePost(detail.value.id, fileName.value)
    detail.value.id = res.id
    usePostsStore().invalidate()
    await open(res.id)
  }

  return {
    detail,
    loading,
    saving,
    dirty,
    body,
    title,
    dateStr,
    tags,
    description,
    draft,
    fileName,
    extras,
    wordCount,
    open,
    markDirty,
    markTouched,
    save,
    rename
  }
})
