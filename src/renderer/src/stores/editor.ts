import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { dump as yamlDump, JSON_SCHEMA, load as yamlLoad } from 'js-yaml'
import { EXTERNAL_MODIFIED_PREFIX } from '@shared/channels'
import type { FrontmatterTemplate, PostDetail } from '@shared/types'
import { useSettingsStore } from './settings'
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

/** 主进程抛出的外部修改冲突错误（IPC 边界只保留 message，靠共享前缀识别） */
function isExternalModifiedError(err: unknown): boolean {
  return String((err as Error | null)?.message ?? '').startsWith(EXTERNAL_MODIFIED_PREFIX)
}

/** 保存结果：saved = 已写盘；aborted = 未保存（YAML 解析失败 / 用户取消覆盖外部修改） */
export type SaveOutcome = 'saved' | 'aborted'

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
  // 打开/上次保存时的文件 stat 基线：保存时回传主进程做外部修改冲突检测
  let baseMtimeMs: number | undefined
  let baseSize: number | undefined
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
      baseMtimeMs = detail.value.baseMtimeMs
      baseSize = detail.value.baseSize
      const fm = detail.value.frontmatter
      const template = await window.api.getFrontmatterTemplate(detail.value.collection)
      deriveKeys(fm, template)
      applyFmToForm(fm)

      body.value = detail.value.body
      fileName.value = detail.value.fileName
    } finally {
      loading.value = false
    }
    // 快照恢复询问放在 loading 结束后：确保文章内容已从磁盘载入再对比/恢复
    await maybeRestoreSnapshot()
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

  // ---- 崩溃快照：编辑产生未保存修改后 2s 防抖写入 localStorage，
  // 渲染层异常退出/崩溃重载后重新打开同一篇文章时可恢复（仅正文） ----
  const SNAPSHOT_KEY = 'astrotools:editor-snapshot'
  const SNAPSHOT_DEBOUNCE_MS = 2000

  interface EditorSnapshot {
    id: string
    body: string
    savedAt: number
  }

  let snapshotTimer: number | undefined

  function readSnapshot(): EditorSnapshot | null {
    try {
      const raw = localStorage.getItem(SNAPSHOT_KEY)
      if (!raw) return null
      const snap = JSON.parse(raw) as EditorSnapshot
      if (typeof snap?.id !== 'string' || typeof snap?.body !== 'string') return null
      return snap
    } catch {
      return null
    }
  }

  /** 清除快照与待写入定时器（保存成功 / 用户明确放弃修改 / 重置编辑器时调用） */
  function discardSnapshot(): void {
    if (snapshotTimer !== undefined) {
      window.clearTimeout(snapshotTimer)
      snapshotTimer = undefined
    }
    localStorage.removeItem(SNAPSHOT_KEY)
  }

  watch(body, () => {
    // 快照功能关闭时不写入（已存在的快照保留，重新开启后仍可恢复）
    if (!useSettingsStore().draftSnapshot) return
    if (!detail.value || !dirty.value) return
    if (snapshotTimer !== undefined) window.clearTimeout(snapshotTimer)
    snapshotTimer = window.setTimeout(() => {
      snapshotTimer = undefined
      if (!detail.value || !dirty.value) return
      const snap: EditorSnapshot = { id: detail.value.id, body: body.value, savedAt: Date.now() }
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
      } catch {
        /* localStorage 不可用时静默跳过，不影响正常编辑 */
      }
    }, SNAPSHOT_DEBOUNCE_MS)
  })

  /** 打开文章后检查崩溃快照：同 id 且内容与磁盘有差异时询问恢复；不匹配的残留快照直接清理 */
  async function maybeRestoreSnapshot(): Promise<void> {
    // 快照功能关闭：跳过恢复询问（不清理快照，重新开启后仍可恢复）
    if (!useSettingsStore().draftSnapshot) return
    const snap = readSnapshot()
    if (!snap) return
    if (!detail.value || snap.id !== detail.value.id || snap.body === body.value) {
      discardSnapshot()
      return
    }
    try {
      await ElMessageBox.confirm(
        '检测到该文章有未保存的编辑内容（可能因异常退出残留），是否恢复？',
        '恢复未保存的草稿',
        {
          type: 'warning',
          confirmButtonText: '恢复草稿',
          cancelButtonText: '丢弃',
          distinguishCancelAndClose: true
        }
      )
    } catch (action) {
      // cancel：明确丢弃 → 清理快照；close（× / Esc）：保留快照，下次打开仍可恢复
      if (action === 'cancel') discardSnapshot()
      return
    }
    body.value = snap.body
    dirty.value = true
    discardSnapshot()
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

  /** 外部修改冲突确认：返回 true 表示用户选择覆盖外部版本 */
  async function confirmOverwriteExternal(): Promise<boolean> {
    try {
      await ElMessageBox.confirm(
        '文件已被其他程序修改（如 git pull 或其他编辑器）。用当前编辑内容覆盖外部版本？选择"取消"可放弃修改后重新打开文章，以载入外部内容。',
        '文件已被外部修改',
        { type: 'warning', confirmButtonText: '覆盖外部版本', cancelButtonText: '取消' }
      )
      return true
    } catch {
      return false
    }
  }

  async function save(): Promise<SaveOutcome> {
    if (!detail.value || saving.value) return 'aborted'
    saving.value = true
    try {
      let fm: Record<string, unknown>
      if (yamlMode.value) {
        const parsed = parseYamlText()
        if (parsed === null) return 'aborted' // 解析失败：yamlError 已设置，中止保存
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

      // 写盘并更新基线。withBase=true 时携带打开/上次保存的 stat，
      // 主进程检测到外部修改会抛冲突错误，由用户确认后不带基线强制覆盖
      const postId = detail.value.id
      const persist = async (withBase: boolean): Promise<void> => {
        const res = await window.api.savePost({
          id: postId,
          frontmatter: fm,
          body: body.value,
          ...(withBase && baseMtimeMs !== undefined ? { baseMtimeMs, baseSize } : {})
        })
        baseMtimeMs = res.mtimeMs
        baseSize = res.size
      }
      try {
        await persist(true)
      } catch (err) {
        if (!isExternalModifiedError(err)) throw err
        if (!(await confirmOverwriteExternal())) return 'aborted'
        await persist(false)
      }

      if (yamlMode.value) {
        applyFmToForm(fm)
        yamlBase = yamlText.value
      }
      dirty.value = false
      discardSnapshot()
      usePostsStore().invalidate()
      return 'saved'
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
    baseMtimeMs = undefined
    baseSize = undefined
    for (const k of Object.keys(touched) as (keyof typeof touched)[]) touched[k] = false
    discardSnapshot()
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
    discardSnapshot,
    enterYamlMode,
    exitYamlMode,
    discardYaml
  }
})
