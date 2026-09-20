<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { ImageItem } from '@shared/types'
import { useProjectStore } from '../stores/project'

const project = useProjectStore()
const images = ref<ImageItem[]>([])
const loading = ref(false)

// 未引用图片检测
const unusedVisible = ref(false)
const unusedChecking = ref(false)
const unusedList = ref<string[]>([])
const unusedSelected = ref<string[]>([])
const unusedDeleting = ref(false)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function load(): Promise<void> {
  loading.value = true
  try {
    images.value = await window.api.listImages()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loading.value = false
  }
}

async function importImages(): Promise<void> {
  try {
    const results = await window.api.importImages()
    if (!results.length) return
    ElMessage.success(
      results.length > 1 ? `已导入 ${results.length} 张图片` : `已导入：${results[0]?.image.name}`
    )
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function removeImage(img: ImageItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除图片「${img.name}」吗？文件将移动到系统回收站，可在回收站中恢复。`,
      '删除图片',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await window.api.deleteImage(img.relPath)
    ElMessage.success('已移入回收站')
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function checkUnused(): Promise<void> {
  unusedVisible.value = true
  unusedChecking.value = true
  unusedSelected.value = []
  try {
    unusedList.value = await window.api.findUnusedImages()
  } catch (err) {
    ElMessage.error((err as Error).message)
    unusedVisible.value = false
  } finally {
    unusedChecking.value = false
  }
}

async function deleteUnusedSelected(): Promise<void> {
  if (!unusedSelected.value.length) {
    ElMessage.warning('请先勾选要删除的图片')
    return
  }
  const count = unusedSelected.value.length
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${count} 张图片吗？文件将移动到系统回收站，可在回收站中恢复。`,
      '批量删除图片',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  unusedDeleting.value = true
  let failed = 0
  try {
    for (const relPath of unusedSelected.value) {
      try {
        await window.api.deleteImage(relPath)
      } catch {
        failed++
      }
    }
    if (failed) ElMessage.warning(`${count - failed} 张已删除，${failed} 张失败`)
    else ElMessage.success(`已移入回收站 ${count} 张图片`)
    unusedSelected.value = []
    unusedVisible.value = false
    await load()
  } finally {
    unusedDeleting.value = false
  }
}

async function copyRef(image: ImageItem): Promise<void> {
  const ref = `![${image.name.replace(/\.[^.]+$/, '')}](${image.refPath})`
  try {
    await navigator.clipboard.writeText(ref)
    ElMessage.success(`已复制引用：${ref}`)
  } catch {
    ElMessage.error('复制失败，请手动复制：' + ref)
  }
}

const unusedSet = computed(() => new Set(unusedList.value))

onMounted(() => {
  void load()
})
</script>

<template>
  <div v-loading="loading" class="images-page">
    <div class="toolbar">
      <span class="hint">
        扫描 {{ project.info?.name ?? '项目' }} 的 public/ 目录，共 {{ images.length }} 张图片
      </span>
      <div class="toolbar-spacer"></div>
      <el-tooltip content="找出未被任何文章/源码引用的图片" placement="top">
        <el-button :icon="Search" @click="checkUnused">查找未引用</el-button>
      </el-tooltip>
      <el-button :icon="Refresh" circle @click="load" />
      <el-button type="primary" :icon="Plus" @click="importImages">导入图片</el-button>
    </div>

    <el-empty v-if="!images.length && !loading" description="public/ 目录下还没有图片资源" />

    <div v-else class="grid">
      <div v-for="img in images" :key="img.relPath" class="image-card panel">
        <div class="thumb-wrap">
          <el-image
            :src="img.url"
            fit="contain"
            class="thumb"
            :preview-src-list="[img.url]"
            :preview-teleported="true"
            hide-on-click-modal
            lazy
          />
        </div>
        <div class="image-info">
          <div class="image-name" :title="img.relPath">
            {{ img.name }}
            <el-tag v-if="unusedSet.has(img.relPath)" size="small" type="info" effect="plain"
              >未引用</el-tag
            >
          </div>
          <div class="image-meta">{{ formatSize(img.size) }} · {{ img.ext.toUpperCase() }}</div>
        </div>
        <div class="image-actions">
          <el-button size="small" :icon="CopyDocument" @click="copyRef(img)">复制引用</el-button>
          <el-tooltip content="移入系统回收站" placement="top">
            <el-button size="small" :icon="Delete" type="danger" plain @click="removeImage(img)" />
          </el-tooltip>
        </div>
      </div>
    </div>

    <el-drawer v-model="unusedVisible" title="未引用图片" size="440px">
      <div v-if="unusedChecking" class="unused-hint">正在扫描源码与文章中的图片引用…</div>
      <template v-else>
        <el-empty v-if="!unusedList.length" description="没有未引用的图片，全部资源都在使用中" />
        <template v-else>
          <div class="unused-hint">
            共 {{ unusedList.length }} 张图片未被任何文章/源码引用，可安全删除（移入回收站）
          </div>
          <el-checkbox-group v-model="unusedSelected" class="unused-list">
            <el-checkbox v-for="p in unusedList" :key="p" :value="p" class="unused-item">
              <span class="unused-path" :title="p">{{ p }}</span>
            </el-checkbox>
          </el-checkbox-group>
          <div class="unused-footer">
            <el-button size="small" @click="unusedSelected = unusedList">全选</el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="unusedDeleting"
              :disabled="!unusedSelected.length"
              @click="deleteUnusedSelected"
            >
              删除所选（{{ unusedSelected.length }}）
            </el-button>
          </div>
        </template>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.images-page {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  font-size: var(--fs-base);
  color: var(--text-sub);
}
.toolbar-spacer {
  flex: 1;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.image-card {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition:
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}
.image-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.thumb-wrap {
  height: 130px;
  border-radius: var(--radius-sm);
  background: var(--thumb-checker);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb {
  width: 100%;
  height: 100%;
  cursor: zoom-in;
}
.image-info {
  min-width: 0;
}
.image-name {
  font-size: var(--fs-base);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}
.image-meta {
  font-size: var(--fs-xs);
  color: var(--text-sub);
  margin-top: 2px;
}
.image-actions {
  display: flex;
  gap: 6px;
}
.image-actions .el-button {
  margin-left: 0;
}
.image-actions .el-button:last-child {
  margin-left: auto;
}

.unused-hint {
  font-size: var(--fs-sm);
  color: var(--text-sub);
  margin-bottom: 12px;
}
.unused-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.unused-item {
  height: auto;
  margin-right: 0;
}
.unused-path {
  font-family: var(--font-mono);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 300px;
  vertical-align: bottom;
}
.unused-footer {
  margin-top: 14px;
  display: flex;
  gap: 8px;
}
</style>
