<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, CircleCheck, Loading, Plus, View } from '@element-plus/icons-vue'
import CodeEditor from '../components/CodeEditor.vue'
import MarkdownPreview from '../components/MarkdownPreview.vue'
import { useEditorStore } from '../stores/editor'
import { usePostsStore } from '../stores/posts'
import { useSettingsStore } from '../stores/settings'

const route = useRoute()
const router = useRouter()
const editor = useEditorStore()
const posts = usePostsStore()
const settings = useSettingsStore()

const metaOpen = ref<string[]>(['meta'])
const previewVisible = ref(true)

const postId = computed(() => decodeURIComponent(String(route.params.id ?? '')))

// YAML 源码模式开关：切回表单时未同步的 YAML 修改先尝试解析应用，失败则确认放弃
const yamlOn = computed({
  get: () => editor.yamlMode,
  set: (v: boolean) => {
    if (v) {
      editor.enterYamlMode()
      return
    }
    if (!editor.yamlDirty || editor.exitYamlMode()) return
    void ElMessageBox.confirm('YAML 内容解析失败，放弃这些修改并返回表单模式？', '提示', {
      type: 'warning',
      confirmButtonText: '放弃修改',
      cancelButtonText: '留在 YAML 模式'
    })
      .then(() => editor.discardYaml())
      .catch(() => {
        /* 保持 YAML 模式 */
      })
  }
})

async function doSave(): Promise<void> {
  try {
    await editor.save()
    ElMessage.success('已保存')
  } catch (err) {
    ElMessage.error(`保存失败: ${(err as Error).message}`)
  }
}

function onWindowKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void doSave()
  }
}

async function doRename(): Promise<void> {
  try {
    await editor.rename()
    ElMessage.success('文件已重命名')
    await posts.reload()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function addExtra(): void {
  editor.extras.push({ key: '', value: '' })
  editor.markDirty()
}

/** 编辑器粘贴/拖入图片：保存到 public/images/ 并返回 markdown 引用插入光标处 */
async function handleImageFile(file: File): Promise<string | null> {
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const result = await window.api.saveImage(file.name, file.type, data)
    ElMessage.success(`图片已保存：${result.image.name}`)
    return result.markdownRef
  } catch (err) {
    ElMessage.error((err as Error).message)
    return null
  }
}

function removeExtra(index: number): void {
  editor.extras.splice(index, 1)
  editor.markDirty()
}

function goBack(): void {
  void router.push('/posts')
}

watch(
  postId,
  (id) => {
    if (id) void editor.open(id)
  },
  { immediate: true }
)

// 脏状态守卫：编辑另一篇文章（路由更新）或离开编辑页（路由离开）前，
// 未保存的修改先经用户确认，避免命令面板/侧栏跳转时静默丢失内容。
async function confirmLeave(): Promise<boolean> {
  if (!editor.dirty) return true
  try {
    await ElMessageBox.confirm('当前文章有未保存的修改。', '未保存的修改', {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: '保存并离开',
      cancelButtonText: '放弃修改并离开'
    })
  } catch (action) {
    // close：点击右上角 × / Esc → 留在当前页；cancel：明确选择放弃 → 放行
    return action === 'cancel'
  }
  try {
    await editor.save()
    // YAML 模式下解析失败时 save() 会静默中止（不抛错），dirty 仍为 true → 留在编辑页
    if (editor.dirty) return false
    return true
  } catch (err) {
    ElMessage.error(`保存失败，仍停留在编辑页: ${(err as Error).message}`)
    return false
  }
}

onBeforeRouteUpdate(async () => confirmLeave())
onBeforeRouteLeave(async () => confirmLeave())

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
})
</script>

<template>
  <div class="editor-page">
    <div class="editor-topbar">
      <el-button :icon="ArrowLeft" circle @click="goBack" />
      <span v-if="editor.dirty" class="dirty-dot" title="有未保存的修改"></span>
      <input
        v-model="editor.title"
        class="title-input"
        placeholder="文章标题"
        :disabled="editor.yamlMode"
        :title="editor.yamlMode ? 'YAML 模式下请在源码中编辑标题' : undefined"
        @input="editor.markTouched('title')"
      />
      <span class="word-count">{{ editor.wordCount }} 字</span>
      <el-tooltip content="切换右侧预览" placement="top">
        <el-button
          :icon="View"
          circle
          :class="{ active: previewVisible }"
          @click="previewVisible = !previewVisible"
        />
      </el-tooltip>
      <el-button
        type="primary"
        :icon="editor.saving ? Loading : CircleCheck"
        :loading="editor.saving"
        @click="doSave"
        >保存</el-button
      >
    </div>

    <el-collapse v-model="metaOpen" class="meta-collapse">
      <el-collapse-item name="meta">
        <template #title>
          <span class="meta-title">文章元数据（frontmatter）</span>
          <span v-if="editor.detail" class="meta-file"
            >{{ editor.detail.collection }} / {{ editor.fileName }}</span
          >
          <span class="yaml-switch-wrap" title="以 YAML 源码方式编辑 frontmatter" @click.stop>
            <el-switch
              v-model="yamlOn"
              size="small"
              inline-prompt
              active-text="YAML"
              inactive-text="表单"
            />
          </span>
        </template>

        <div v-loading="editor.loading" class="meta-body">
          <el-alert
            v-if="editor.yamlError"
            class="yaml-alert"
            type="error"
            show-icon
            :closable="false"
            title="YAML 解析失败，请修正后重试"
            :description="editor.yamlError ?? ''"
          />
          <div v-if="editor.yamlMode" class="yaml-editor-wrap">
            <CodeEditor
              v-model="editor.yamlText"
              language="yaml"
              :dark="settings.isDark"
              :font-size="settings.editorFontSize"
            />
          </div>
          <div v-show="!editor.yamlMode" class="meta-grid">
            <div class="meta-item">
              <label>发布日期</label>
              <el-date-picker
                v-model="editor.dateStr"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                style="width: 100%"
                @change="editor.markTouched('date')"
              />
            </div>
            <div class="meta-item">
              <label>标签</label>
              <el-select
                v-model="editor.tags"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="输入后回车创建"
                style="width: 100%"
                @change="editor.markTouched('tags')"
              >
                <el-option
                  v-for="t in posts.tagCounts.slice(0, 30)"
                  :key="t.name"
                  :label="t.name"
                  :value="t.name"
                />
              </el-select>
            </div>
            <div class="meta-item draft-item">
              <label>草稿</label>
              <el-switch v-model="editor.draft" @change="editor.markTouched('draft')" />
            </div>
            <div class="meta-item span-2">
              <label>描述</label>
              <el-input
                v-model="editor.description"
                type="textarea"
                :rows="2"
                placeholder="文章摘要（可选）"
                @input="editor.markTouched('description')"
              />
            </div>
            <div class="meta-item span-2 rename-row">
              <label>文件名</label>
              <div class="rename-control">
                <el-input v-model="editor.fileName" placeholder="文件名" />
                <el-button size="default" @click="doRename">重命名</el-button>
              </div>
            </div>

            <div class="meta-item span-2">
              <label>其他字段</label>
              <div class="extras">
                <div v-for="(f, i) in editor.extras" :key="i" class="extra-row">
                  <el-input
                    v-model="f.key"
                    class="extra-key"
                    placeholder="字段名"
                    @input="editor.markDirty()"
                  />
                  <el-input
                    v-model="f.value"
                    type="textarea"
                    :rows="1"
                    :autosize="{ minRows: 1, maxRows: 6 }"
                    class="extra-value"
                    placeholder="值（对象/数组用 JSON 表示）"
                    @input="editor.markDirty()"
                  />
                  <el-button size="default" text type="danger" @click="removeExtra(i)"
                    >移除</el-button
                  >
                </div>
                <el-button size="small" :icon="Plus" @click="addExtra">添加字段</el-button>
              </div>
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <div class="editor-body" :class="{ 'no-preview': !previewVisible }">
      <div class="editor-pane">
        <CodeEditor
          v-model="editor.body"
          :image-handler="handleImageFile"
          :dark="settings.isDark"
          :font-size="settings.editorFontSize"
          @update:model-value="editor.markDirty()"
        />
      </div>
      <div v-if="previewVisible" class="preview-pane">
        <div class="preview-label">实时预览</div>
        <div class="preview-scroll">
          <MarkdownPreview :source="editor.body" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.editor-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.dirty-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #f59e0b;
  flex-shrink: 0;
}
.title-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 19px;
  font-weight: 700;
  color: var(--text-main);
  padding: 4px 2px;
}
.title-input::placeholder {
  color: #b3b8c6;
}
.word-count {
  font-size: 12px;
  color: var(--text-sub);
  flex-shrink: 0;
}

.meta-collapse {
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--border-soft);
  --el-collapse-border-color: var(--border-soft);
}
.meta-collapse :deep(.el-collapse-item__header) {
  padding: 0 14px;
  background: var(--bg-panel-alt);
  border-radius: 10px 10px 0 0;
}
.meta-collapse :deep(.el-collapse-item__wrap) {
  border-radius: 0 0 10px 10px;
}
.meta-title {
  font-weight: 600;
  font-size: 13px;
}
.meta-file {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-sub);
}
.yaml-switch-wrap {
  margin-left: auto;
  margin-right: 12px;
  display: inline-flex;
  align-items: center;
}
.meta-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.yaml-alert {
  border-radius: 8px;
}
.yaml-editor-wrap {
  height: 260px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-card);
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
  padding: 4px 14px 14px;
}
.meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.meta-item label {
  font-size: 12px;
  color: var(--text-sub);
  font-weight: 600;
}
.meta-item.span-2 {
  grid-column: span 2;
}
.draft-item {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}
.rename-control {
  display: flex;
  gap: 8px;
}

.extras {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.extra-row {
  display: flex;
  gap: 8px;
  width: 100%;
  align-items: flex-start;
}
.extra-key {
  width: 180px;
  flex-shrink: 0;
}
.extra-value {
  flex: 1;
}

.editor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}
.editor-pane {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-card);
}
.editor-body.no-preview .editor-pane {
  flex: 1;
}

.preview-pane {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.preview-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-sub);
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--bg-panel-alt);
}
.preview-scroll {
  flex: 1;
  overflow: auto;
  padding: 18px 24px;
}

@media (max-width: 1200px) {
  .editor-body {
    flex-direction: column;
  }
  .preview-pane {
    min-height: 200px;
  }
}
</style>
