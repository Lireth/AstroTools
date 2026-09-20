<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, RefreshRight, VideoPlay } from '@element-plus/icons-vue'
import { useDevServerStore } from '../stores/devServer'

const dev = useDevServerStore()
const webviewRef = ref<(HTMLElement & { reload: () => void }) | null>(null)
const reloadKey = ref(0)

const isRunning = computed(() => dev.state.status === 'running' && !!dev.state.url)

async function startDev(): Promise<void> {
  try {
    await dev.start()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function reloadWebview(): void {
  webviewRef.value?.reload()
  reloadKey.value++
}

async function openExternal(): Promise<void> {
  if (dev.state.url) await window.api.openExternal(dev.state.url)
}

// dev server 未就绪时清掉 webview，就绪后重新挂载
watch(isRunning, (running) => {
  if (!running) reloadKey.value++
})
</script>

<template>
  <div class="preview-page">
    <template v-if="isRunning">
      <div class="preview-toolbar">
        <el-tag type="success" effect="light" size="small">运行中</el-tag>
        <span class="url" :title="dev.state.url">{{ dev.state.url }}</span>
        <div class="toolbar-spacer"></div>
        <el-button size="small" :icon="RefreshRight" @click="reloadWebview">刷新</el-button>
        <el-button size="small" :icon="Link" @click="openExternal">在浏览器打开</el-button>
      </div>
      <div class="webview-wrap">
        <webview
          v-if="dev.state.url"
          :key="reloadKey"
          ref="webviewRef"
          :src="dev.state.url"
          class="webview"
        />
      </div>
    </template>

    <div v-else class="placeholder">
      <div class="placeholder-card panel">
        <div class="placeholder-icon">🖥️</div>
        <h2>站点预览</h2>
        <p v-if="dev.state.status === 'starting'">开发服务器启动中，请稍候…</p>
        <p v-else-if="dev.state.status === 'error'" class="error-text">
          启动失败：
          <span class="error-detail">{{ dev.state.message ?? '未知错误' }}</span>
        </p>
        <p v-else>启动 Astro 开发服务器后即可在此实时预览博客站点</p>
        <el-button
          type="primary"
          :icon="VideoPlay"
          :disabled="dev.state.status === 'starting' || dev.state.status === 'stopping'"
          @click="startDev"
        >
          启动开发服务器
        </el-button>
        <div v-if="dev.state.message && dev.state.status === 'starting'" class="log">
          {{ dev.state.message }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.url {
  font-size: var(--fs-base);
  color: var(--text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toolbar-spacer {
  flex: 1;
}

.webview-wrap {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
}
.webview {
  width: 100%;
  height: 100%;
  display: block;
}

.placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.placeholder-card {
  text-align: center;
  padding: 42px 56px;
  max-width: 520px;
}
.placeholder-icon {
  font-size: 44px;
}
.placeholder-card h2 {
  margin: 14px 0 8px;
  font-size: var(--fs-lg);
}
.placeholder-card p {
  color: var(--text-sub);
  font-size: var(--fs-base);
  margin: 0 0 18px;
}
.error-text {
  color: var(--danger) !important;
}
.error-detail {
  display: block;
  margin-top: 6px;
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  text-align: left;
  max-height: 140px;
  overflow: auto;
  background: color-mix(in srgb, var(--danger) 8%, var(--bg-panel));
  border: 1px solid color-mix(in srgb, var(--danger) 20%, transparent);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  color: var(--danger);
}
.log {
  margin-top: 14px;
  font-size: var(--fs-sm);
  color: var(--text-sub);
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  white-space: pre-wrap;
  text-align: left;
  max-height: 120px;
  overflow: auto;
}
</style>
