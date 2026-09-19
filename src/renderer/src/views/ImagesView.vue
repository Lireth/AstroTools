<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Plus, Refresh } from '@element-plus/icons-vue'
import type { ImageItem } from '@shared/types'
import { useProjectStore } from '../stores/project'

const project = useProjectStore()
const images = ref<ImageItem[]>([])
const loading = ref(false)

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

async function importImage(): Promise<void> {
  try {
    const result = await window.api.importImage()
    if (!result) return
    ElMessage.success(`已导入：${result.image.name}`)
    await load()
  } catch (err) {
    ElMessage.error((err as Error).message)
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

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="images-page" v-loading="loading">
    <div class="toolbar">
      <span class="hint">
        扫描 {{ project.info?.name ?? '项目' }} 的 public/ 目录，共 {{ images.length }} 张图片
      </span>
      <div class="toolbar-spacer"></div>
      <el-button :icon="Refresh" circle @click="load" />
      <el-button type="primary" :icon="Plus" @click="importImage">导入图片</el-button>
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
          <div class="image-name" :title="img.relPath">{{ img.name }}</div>
          <div class="image-meta">{{ formatSize(img.size) }} · {{ img.ext.toUpperCase() }}</div>
        </div>
        <el-button size="small" :icon="CopyDocument" @click="copyRef(img)">复制引用</el-button>
      </div>
    </div>
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
  font-size: 13px;
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
}
.thumb-wrap {
  height: 130px;
  border-radius: 8px;
  background:
    conic-gradient(#f0f1f6 25%, #fff 0 50%, #f0f1f6 0 75%, #fff 0) 0 0/16px 16px;
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
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.image-meta {
  font-size: 11.5px;
  color: var(--text-sub);
  margin-top: 2px;
}
</style>
