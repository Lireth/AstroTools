<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, EditPen, Plus, Refresh, Search } from '@element-plus/icons-vue'
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

onMounted(() => {
  void posts.load()
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
      <div class="toolbar-spacer"></div>
      <span class="count-hint">共 {{ posts.filtered.length }} 篇</span>
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
        <div class="post-main">
          <div class="post-title-row">
            <span class="post-title">{{ p.title }}</span>
            <el-tag v-if="p.draft" type="warning" size="small" effect="light">草稿</el-tag>
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
}
.post-item:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 16px rgba(124, 92, 252, 0.08);
}

.post-main {
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
</style>
