<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Connection, Delete, EditPen, Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { BulkUpdateResult, GitFileStatus, LinkIssue } from '@shared/types'
import { usePostsStore } from '../stores/posts'
import { useProjectStore } from '../stores/project'

const router = useRouter()
const posts = usePostsStore()
const project = useProjectStore()

const createVisible = ref(false)
const creating = ref(false)

const form = reactive({
  collection: '',
  fileName: '',
  title: '',
  tags: [] as string[],
  draft: false,
  description: ''
})
const fileNameEdited = ref(false)

const collectionNames = computed(() => project.info?.collections.map((c) => c.name) ?? [])

const hasFilters = computed(
  () => posts.query || posts.tag || posts.draftOnly || posts.collection
)

// ---- 批量选择 ----
const selected = ref<string[]>([])
const selectedSet = computed(() => new Set(selected.value))

function toggleSelect(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id]
}

const allSelected = computed({
  get: () => posts.filtered.length > 0 && posts.filtered.every((p) => selectedSet.value.has(p.id)),
  set: (v: boolean) => {
    selected.value = v ? posts.filtered.map((p) => p.id) : []
  }
})
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value)

function summarize(results: BulkUpdateResult[], successText: string): void {
  const fails = results.filter((r) => !r.ok)
  if (!fails.length) {
    ElMessage.success(`${successText}（${results.length} 篇）`)
    return
  }
  const detail = fails
    .slice(0, 3)
    .map((f) => `${f.id.split('/').pop() ?? f.id}：${f.error ?? '失败'}`)
    .join('；')
  ElMessage.warning(
    `成功 ${results.length - fails.length} 篇，失败 ${fails.length} 篇：${detail}${fails.length > 3 ? '…' : ''}`
  )
}

async function bulkSetDraft(draft: boolean): Promise<void> {
  const ids = [...selected.value]
  try {
    const results = await posts.bulkUpdate(ids, { draft })
    summarize(results, draft ? '已转为草稿' : '已发布')
    await posts.reload()
    selected.value = []
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

const bulkTagVisible = ref(false)
const bulkTags = ref<string[]>([])

function openBulkTags(): void {
  bulkTags.value = []
  bulkTagVisible.value = true
}

async function submitBulkTags(): Promise<void> {
  if (!bulkTags.value.length) {
    ElMessage.warning('请选择或输入至少一个标签')
    return
  }
  const ids = [...selected.value]
  bulkTagVisible.value = false
  try {
    const results = await posts.bulkUpdate(ids, { addTags: [...bulkTags.value] })
    summarize(results, '标签已更新')
    await posts.reload()
    selected.value = []
    bulkTags.value = []
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function bulkDelete(): Promise<void> {
  const ids = [...selected.value]
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${ids.length} 篇文章吗？文件将移动到系统回收站，可在回收站中恢复。`,
      '批量删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    const results = await posts.bulkRemove(ids)
    summarize(results, '已移入回收站')
    await posts.reload()
    selected.value = []
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ---- 死链检查 ----
const checking = ref(false)
const linkDrawer = ref(false)
const linkIssues = ref<LinkIssue[]>([])

async function runLinkCheck(): Promise<void> {
  checking.value = true
  linkDrawer.value = true
  try {
    linkIssues.value = await window.api.checkLinks()
  } catch (err) {
    ElMessage.error((err as Error).message)
    linkDrawer.value = false
  } finally {
    checking.value = false
  }
}

const groupedIssues = computed(() => {
  const map = new Map<string, { postId: string; postTitle: string; items: LinkIssue[] }>()
  for (const it of linkIssues.value) {
    let g = map.get(it.postId)
    if (!g) {
      g = { postId: it.postId, postTitle: it.postTitle, items: [] }
      map.set(it.postId, g)
    }
    g.items.push(it)
  }
  return [...map.values()]
})

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function autoFileName(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^[-]+|[-]+$/g, '') || 'new-post'
  )
}

watch(
  () => form.title,
  (t) => {
    if (!fileNameEdited.value) form.fileName = autoFileName(t)
  }
)

function openCreate(): void {
  form.collection = posts.collection ?? collectionNames.value[0] ?? ''
  form.title = ''
  form.fileName = 'new-post'
  fileNameEdited.value = false
  form.tags = []
  form.draft = false
  form.description = ''
  createVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!form.title.trim()) {
    ElMessage.warning('请填写文章标题')
    return
  }
  if (!form.collection) {
    ElMessage.warning('请选择内容集合')
    return
  }
  creating.value = true
  try {
    const id = await posts.createFromDialog({
      collection: form.collection,
      fileName: form.fileName || autoFileName(form.title),
      title: form.title.trim(),
      tags: [...form.tags],
      draft: form.draft,
      description: form.description
    })
    createVisible.value = false
    ElMessage.success('文章已创建')
    await posts.reload()
    await router.push(`/editor/${encodeURIComponent(id)}`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    creating.value = false
  }
}

function openEditor(id: string): void {
  void router.push(`/editor/${encodeURIComponent(id)}`)
}

async function removePost(id: string, title: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除文章「${title}」吗？文件将移动到系统回收站，可在回收站中恢复。`,
      '删除文章',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await posts.remove(id)
    ElMessage.success('已移入回收站')
    await posts.reload()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// ---- git 集成 ----
const GIT_BADGE: Record<GitFileStatus, { text: string; type: 'warning' | 'success' | 'info' | 'danger' }> = {
  modified: { text: '修改', type: 'warning' },
  added: { text: '新增', type: 'success' },
  deleted: { text: '删除', type: 'danger' },
  untracked: { text: '未跟踪', type: 'info' }
}
const commitDialogVisible = ref(false)
const commitMessage = ref('')
const committing = ref(false)

function gitBadge(id: string): { text: string; type: 'warning' | 'success' | 'info' | 'danger' } | null {
  const s = posts.gitFiles[id]
  return s ? GIT_BADGE[s] : null
}

function openCommitDialog(): void {
  commitMessage.value = `docs: 更新 ${selected.value.length} 篇文章`
  commitDialogVisible.value = true
}

async function submitCommit(): Promise<void> {
  if (!commitMessage.value.trim()) {
    ElMessage.warning('请填写提交说明')
    return
  }
  committing.value = true
  try {
    await posts.commitFiles([...selected.value], commitMessage.value)
    commitDialogVisible.value = false
    ElMessage.success(`已提交 ${selected.value.length} 篇文章`)
    selected.value = []
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    committing.value = false
  }
}

onMounted(() => {
  void posts.load()
  void posts.loadGitStatus()
})
</script>

<template>
  <div class="post-list">
    <div class="toolbar">
      <el-input
        v-model="posts.query"
        class="search-input"
        placeholder="搜索标题、正文、标签…"
        :prefix-icon="Search"
        clearable
      />
      <el-checkbox v-model="posts.draftOnly" label="仅看草稿" />
      <el-checkbox
        v-model="allSelected"
        :indeterminate="someSelected"
        :disabled="!posts.filtered.length"
        >全选</el-checkbox
      >
      <div class="toolbar-spacer"></div>
      <span class="count-hint">共 {{ posts.filtered.length }} 篇</span>
      <el-tooltip content="检查站内链接与图片引用" placement="top">
        <el-button :icon="Connection" :loading="checking" @click="runLinkCheck">检查死链</el-button>
      </el-tooltip>
      <el-tooltip content="重新扫描文章" placement="top">
        <el-button :icon="Refresh" circle @click="posts.reload()" />
      </el-tooltip>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建文章</el-button>
    </div>

    <div v-if="posts.tag || posts.collection" class="active-filters">
      <el-tag v-if="posts.collection" closable @close="posts.collection = null">
        集合：{{ posts.collection }}
      </el-tag>
      <el-tag v-if="posts.tag" closable type="warning" @close="posts.tag = null">
        标签：{{ posts.tag }}
      </el-tag>
    </div>

    <div v-if="posts.loading && !posts.posts.length" class="empty-wrap" v-loading="true"></div>

    <el-empty v-else-if="!posts.filtered.length" :description="hasFilters ? '没有符合筛选条件的文章' : '这个博客还没有文章，点击右上角新建一篇吧'">
      <el-button v-if="hasFilters" @click="posts.clearFilters()">清除筛选</el-button>
    </el-empty>

    <div v-else class="list">
      <div
        v-for="p in posts.filtered"
        :key="p.id"
        class="post-item panel"
        @click="openEditor(p.id)"
      >
        <div class="post-check" @click.stop>
          <el-checkbox :model-value="selectedSet.has(p.id)" @change="toggleSelect(p.id)" />
        </div>
        <div class="post-main">
          <div class="post-title-row">
            <span class="post-title">{{ p.title }}</span>
            <el-tag v-if="p.draft" type="warning" size="small" effect="light">草稿</el-tag>
            <el-tag v-if="gitBadge(p.id)" :type="gitBadge(p.id)!.type" size="small" effect="plain">
              {{ gitBadge(p.id)!.text }}
            </el-tag>
          </div>
          <div v-if="p.description" class="post-desc">{{ p.description }}</div>
          <div class="post-tags">
            <span v-for="t in p.tags.slice(0, 6)" :key="t" class="post-tag" @click.stop="posts.tag = t">
              #{{ t }}
            </span>
          </div>
        </div>
        <div class="post-side">
          <span class="post-date">{{ formatDate(p.date) }}</span>
          <div class="post-actions" @click.stop>
            <el-tooltip content="编辑" placement="top">
              <el-button :icon="EditPen" circle size="small" @click="openEditor(p.id)" />
            </el-tooltip>
            <el-tooltip content="删除（移入回收站）" placement="top">
              <el-button :icon="Delete" circle size="small" type="danger" plain @click="removePost(p.id, p.title)" />
            </el-tooltip>
          </div>
        </div>
      </div>
    </div>

    <transition name="bulk-fade">
      <div v-if="selected.length" class="bulk-bar panel">
        <span class="bulk-count">已选 {{ selected.length }} 篇</span>
        <el-button size="small" @click="bulkSetDraft(false)">发布</el-button>
        <el-button size="small" @click="bulkSetDraft(true)">转草稿</el-button>
        <el-button size="small" @click="openBulkTags">加标签</el-button>
        <el-button v-if="posts.isGitRepo" size="small" type="primary" plain @click="openCommitDialog">
          提交
        </el-button>
        <el-button size="small" type="danger" plain :icon="Delete" @click="bulkDelete">删除</el-button>
        <el-button size="small" text @click="selected = []">取消</el-button>
      </div>
    </transition>

    <el-dialog v-model="bulkTagVisible" title="批量添加标签" width="420px">
      <el-select
        v-model="bulkTags"
        multiple
        filterable
        allow-create
        default-first-option
        placeholder="输入后回车创建标签（将追加合并到所选文章）"
        style="width: 100%"
      >
        <el-option v-for="t in posts.tagCounts.slice(0, 30)" :key="t.name" :label="t.name" :value="t.name" />
      </el-select>
      <template #footer>
        <el-button @click="bulkTagVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBulkTags">应用到 {{ selected.length }} 篇</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="linkDrawer" title="死链检查" size="480px">
      <div v-if="checking" class="issue-hint">正在检查站内链接与图片引用…</div>
      <template v-else>
        <el-empty v-if="!linkIssues.length" description="未发现问题，全部引用有效" />
        <template v-else>
          <div class="issue-summary">
            共 {{ linkIssues.length }} 处问题，涉及 {{ groupedIssues.length }} 篇文章；点击文章标题跳转编辑
          </div>
          <div v-for="g in groupedIssues" :key="g.postId" class="issue-group panel">
            <div class="issue-post" @click="openEditor(g.postId)">
              {{ g.postTitle }}
              <span class="issue-count">{{ g.items.length }}</span>
            </div>
            <div v-for="(it, i) in g.items" :key="i" class="issue-item">
              <el-tag size="small" :type="it.type === 'image' ? 'warning' : 'danger'" effect="light">
                {{ it.type === 'image' ? '图片' : '链接' }}
              </el-tag>
              <span class="issue-target" :title="it.target">{{ it.target }}</span>
              <span class="issue-reason">{{ it.reason }}</span>
            </div>
          </div>
        </template>
      </template>
    </el-drawer>

    <el-dialog v-model="commitDialogVisible" title="Git 提交所选文章" width="480px">
      <div class="commit-hint">
        仅提交选中的 {{ selected.length }} 篇文章（git add 指定文件），不影响其他未提交改动。
      </div>
      <el-input
        v-model="commitMessage"
        type="textarea"
        :rows="3"
        placeholder="提交说明（commit message）"
      />
      <template #footer>
        <el-button @click="commitDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="committing" @click="submitCommit">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createVisible" title="新建文章" width="520px">
      <el-form label-width="80px" label-position="left">
        <el-form-item label="内容集合" required>
          <el-select v-model="form.collection" placeholder="选择集合" style="width: 100%">
            <el-option v-for="c in collectionNames" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题" required>
          <el-input v-model="form.title" placeholder="文章标题" maxlength="120" />
        </el-form-item>
        <el-form-item label="文件名">
          <el-input v-model="form.fileName" placeholder="文件名（.md / .mdx）" @input="fileNameEdited = true">
            <template #append>.md</template>
          </el-input>
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="form.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入后回车创建标签"
            style="width: 100%"
          >
            <el-option v-for="t in posts.tagCounts.slice(0, 30)" :key="t.name" :label="t.name" :value="t.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="文章摘要（可选）" />
        </el-form-item>
        <el-form-item label="草稿">
          <el-switch v-model="form.draft" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建并编辑</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.post-list {
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.search-input {
  width: 320px;
}
.toolbar-spacer {
  flex: 1;
}
.count-hint {
  font-size: 12.5px;
  color: var(--text-sub);
}

.active-filters {
  display: flex;
  gap: 8px;
}

.empty-wrap {
  height: 320px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
  /* 大列表渲染优化：视口外跳过渲染（高度按经验值参与滚动估算） */
  content-visibility: auto;
  contain-intrinsic-size: auto 96px;
}
.post-item:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 16px rgba(124, 92, 252, 0.08);
}

.post-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.post-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.post-title {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.post-desc {
  font-size: 13px;
  color: var(--text-sub);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.post-tag {
  font-size: 12px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;
}
.post-tag:hover {
  background: var(--el-color-primary-light-7);
}

.post-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
}
.post-date {
  font-size: 12.5px;
  color: var(--text-sub);
}
.post-actions {
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.post-item:hover .post-actions {
  opacity: 1;
}

.post-check {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 3px;
}

.bulk-bar {
  position: fixed;
  bottom: 24px;
  left: calc(50% + 132px);
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14);
}
.bulk-count {
  font-size: 13px;
  font-weight: 600;
  margin-right: 4px;
}

.commit-hint {
  font-size: 12.5px;
  color: var(--text-sub);
  margin-bottom: 10px;
}
.bulk-fade-enter-active,
.bulk-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.bulk-fade-enter-from,
.bulk-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.issue-hint {
  font-size: 13px;
  color: var(--text-sub);
}
.issue-summary {
  font-size: 12.5px;
  color: var(--text-sub);
  margin-bottom: 12px;
}
.issue-group {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.issue-post {
  font-weight: 700;
  font-size: 13.5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
.issue-post:hover {
  color: var(--el-color-primary);
}
.issue-count {
  font-size: 11px;
  background: #fef2f2;
  color: #b91c1c;
  border-radius: 999px;
  padding: 0 7px;
}
.issue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  min-width: 0;
}
.issue-target {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.issue-reason {
  color: #b91c1c;
  flex-shrink: 0;
  margin-left: auto;
  font-size: 12px;
}
</style>
