import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { dump as yamlDump, JSON_SCHEMA, load as yamlLoad } from 'js-yaml'
import type { FrontmatterTemplate, PostDetail } from '@shared/types'
import { usePostsStore } from './posts'

export interface ExtraField {
  key: string
  value: string
}

// 与主进程 postService 的 yamlEngine 保持一致：日期按字符串读入/写出（YAML 1.2 JSON schema）。
// 若用默认 schema，yamlLoad 会把 `2024-05-01` 解析成 Date，而主进程保存时按 JSON_SCHEMA
// dump 不接受 Date 对象，YAML 模式保存将直接报错。
const YAML_DUMP_OPTS = { schema: JSON_SCHEMA, lineWidth: -1, noRefs: true }
const YAML_LOAD_OPTS = { schema: JSON_SCHEMA }

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

  // YAML 源码模式：开启时 YAML 文本为唯一事实源，保存/切回表单时解析回写
  const yamlMode = ref(false)
  const yamlText = ref('')
  const yamlError = ref<string | null>(null)
  // 上次同步基准文本，用于判断切回表单时是否有未应用的修改
  let yamlBase = ''

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
        const hit =
          fmKeys.find((k) => pattern.test(k)) ?? template.keys.find((k) => pattern.test(k))
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
    yamlMode.value = false
    yamlError.value = null
    try {
      detail.value = await window.api.readPost(id)
      const fm = detail.value.frontmatter
      const template = await window.api.getFrontmatterTemplate(detail.value.collection)
      deriveKeys(fm, template)
      applyFmToForm(fm)

      body.value = detail.value.body
      fileName.value = detail.value.fileName
    } finally {
      loading.value = false
    }
  }

  /** 把 frontmatter 对象映射到表单字段（打开文章与 YAML 模式切回共用） */
  function applyFmToForm(fm: Record<string, unknown>): void {
    originalFm = fm
    title.value =
      typeof fm[titleKey] === 'string' ? (fm[titleKey] as string) : (detail.value?.title ?? '')
    const dateVal = dateKey ? fm[dateKey] : undefined
    const dateIso =
      dateVal instanceof Date && !Number.isNaN(dateVal.getTime())
        ? dateVal.toISOString()
        : typeof dateVal === 'string' && !Number.isNaN(new Date(dateVal).getTime())
          ? new Date(dateVal).toISOString()
          : undefined
    dateStr.value = dateIso ? dateIso.slice(0, 10) : ''
    const rawTags = tagsKey ? fm[tagsKey] : undefined
    tags.value = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawTags === 'string'
        ? rawTags
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : []
    description.value = typeof fm[descriptionKey] === 'string' ? (fm[descriptionKey] as string) : ''
    draft.value =
      draftKey.toLowerCase() === 'published' ? fm[draftKey] === false : fm[draftKey] === true

    const known = new Set(
      [titleKey, dateKey, tagsKey, descriptionKey, draftKey].map((k) => k.toLowerCase())
    )
    extras.value = Object.entries(fm)
      .filter(([k]) => !known.has(k.toLowerCase()))
      .map(([k, v]) => ({ key: k, value: extraValueText(v) }))

    for (const k of Object.keys(touched) as (keyof typeof touched)[]) touched[k] = false
  }

  function markDirty(): void {
    dirty.value = true
  }

  function markTouched(field: keyof typeof touched): void {
    touched[field] = true
    dirty.value = true
  }

  const yamlDirty = computed(() => yamlMode.value && yamlText.value !== yamlBase)

  function enterYamlMode(): void {
    if (!detail.value) return
    yamlText.value = yamlDump(detail.value.frontmatter ?? {}, YAML_DUMP_OPTS)
    yamlBase = yamlText.value
    yamlError.value = null
    yamlMode.value = true
  }

  /** 解析当前 YAML 文本；失败时设置 yamlError 并返回 null */
  function parseYamlText(): Record<string, unknown> | null {
    try {
      const parsed: unknown = yamlLoad(yamlText.value, YAML_LOAD_OPTS)
      if (parsed === null || parsed === undefined) {
        yamlError.value = null
        return {}
      }
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        yamlError.value = 'frontmatter 必须是键值映射，当前解析结果是数组或标量'
        return null
      }
      yamlError.value = null
      return parsed as Record<string, unknown>
    } catch (err) {
      yamlError.value = (err as Error).message
      return null
    }
  }

  /** 切回表单模式：解析成功并同步表单返回 true；失败保持 YAML 模式，由调用方决定是否放弃 */
  function exitYamlMode(): boolean {
    const fm = parseYamlText()
    if (fm === null) return false
    applyFmToForm(fm)
    yamlMode.value = false
    return true
  }

  /** 放弃 YAML 修改，直接退回表单模式 */
  function discardYaml(): void {
    yamlMode.value = false
    yamlError.value = null
  }

  async function save(): Promise<void> {
    if (!detail.value || saving.value) return
    saving.value = true
    try {
      let fm: Record<string, unknown>
      if (yamlMode.value) {
        const parsed = parseYamlText()
        if (parsed === null) return // 解析失败：yamlError 已设置，中止保存
        fm = parsed
      } else {
        fm = { ...originalFm }
        const write = (key: string, value: unknown, isTouched: boolean): void => {
          if (
            Object.keys(originalFm).some((k) => k.toLowerCase() === key.toLowerCase()) ||
            isTouched
          ) {
            fm[key] = value
          }
        }

        write(titleKey, title.value.trim(), touched.title)
        if (touched.date) {
          if (dateStr.value) {
            fm[dateKey] = dateStr.value
          } else if (
            Object.keys(originalFm).some((k) => k.toLowerCase() === dateKey.toLowerCase())
          ) {
            // 用户清空了日期且该键原本存在 → 移除键（此前清空操作不生效）
            delete fm[dateKey]
          }
        }
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
      }

      await window.api.savePost({ id: detail.value.id, frontmatter: fm, body: body.value })
      if (yamlMode.value) {
        applyFmToForm(fm)
        yamlBase = yamlText.value
      }
      dirty.value = false
      usePostsStore().invalidate()
    } finally {
      saving.value = false
    }
  }

  /** 清空全部编辑状态（切换项目时调用，防止旧项目的编辑内容残留、误存到新项目） */
  function reset(): void {
    detail.value = null
    loading.value = false
    saving.value = false
    dirty.value = false
    body.value = ''
    title.value = ''
    dateStr.value = ''
    tags.value = []
    description.value = ''
    draft.value = false
    fileName.value = ''
    extras.value = []
    yamlMode.value = false
    yamlText.value = ''
    yamlError.value = null
    yamlBase = ''
    originalFm = {}
    for (const k of Object.keys(touched) as (keyof typeof touched)[]) touched[k] = false
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
    yamlMode,
    yamlText,
    yamlError,
    yamlDirty,
    open,
    markDirty,
    markTouched,
    save,
    rename,
    reset,
    enterYamlMode,
    exitYamlMode,
    discardYaml
  }
})
