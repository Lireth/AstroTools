<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ThemeMode } from '@shared/types'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  DataAnalysis,
  Document,
  Picture,
  Promotion,
  Refresh,
  Right,
  Search,
  Setting,
  SwitchButton,
  VideoPlay,
  VideoPause
} from '@element-plus/icons-vue'
import CommandPalette from './CommandPalette.vue'
import { useProjectStore } from '../stores/project'
import { usePostsStore } from '../stores/posts'
import { useEditorStore } from '../stores/editor'
import { useDevServerStore } from '../stores/devServer'
import { useBuildStore } from '../stores/build'
import { useSettingsStore } from '../stores/settings'

const route = useRoute()
const router = useRouter()
const project = useProjectStore()
const posts = usePostsStore()
const editor = useEditorStore()
const dev = useDevServerStore()
const build = useBuildStore()
const settings = useSettingsStore()

const paletteOpen = ref(false)
const buildLogOpen = ref(false)
const settingsOpen = ref(false)

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault()
    paletteOpen.value = true
  }
}

const collections = computed(() => project.info?.collections ?? [])
const collectionModel = computed({
  get: () => posts.collection ?? '',
  set: (v: string) => {
    posts.collection = v === '' ? null : v
  }
})

const topTags = computed(() => posts.tagCounts.slice(0, 24))

const devStatusText = computed(
  () =>
    ({
      idle: '已停止',
      starting: '启动中…',
      running: '运行中',
      stopping: '停止中…',
      error: '异常'
    })[dev.state.status]
)

const buildStatusText = computed(
  () =>
    ({
      idle: '未构建',
      building: '构建中…',
      done: build.state.durationMs
        ? `完成（${Math.round(build.state.durationMs / 1000)}s）`
        : '完成',
      error: '失败'
    })[build.state.status]
)

async function startBuild(): Promise<void> {
  try {
    await build.start()
    buildLogOpen.value = true
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

const navItems = [
  { path: '/posts', label: '文章管理', icon: Document },
  { path: '/dashboard', label: '统计', icon: DataAnalysis },
  { path: '/images', label: '图片资源', icon: Picture },
  { path: '/preview', label: '站点预览', icon: Promotion }
]

function isActive(path: string): boolean {
  if (path === '/posts') return route.path === '/posts' || route.path.startsWith('/editor')
  return route.path.startsWith(path)
}

function pickTag(name: string): void {
  posts.tag = posts.tag === name ? null : name
  if (route.path !== '/posts') void router.push('/posts')
}

async function refreshProject(): Promise<void> {
  try {
    await project.refresh()
  } catch (err) {
    ElMessage.error(`刷新项目信息失败: ${(err as Error).message}`)
  }
}

function openSite(): void {
  const site = project.info?.site
  if (site) void window.api.openExternal(site)
}

function openProjectFolder(): void {
  void window.api.showProjectInFolder()
}

async function toggleDev(): Promise<void> {
  try {
    if (dev.state.status === 'running' || dev.state.status === 'starting') {
      await dev.stop()
    } else {
      await dev.start()
    }
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

// 项目切换时：清空编辑器状态（防止旧项目文章内容残留、误存到新项目），
// 清空筛选并重新加载文章
watch(
  () => project.info?.path,
  () => {
    editor.reset()
    posts.clearFilters()
    void posts.load(true)
  }
)

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  dev.init()
  build.init()
  posts.initExternalSync()
  if (project.info) void posts.load(true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  dev.dispose()
  build.dispose()
  posts.disposeExternalSync()
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-logo">A</div>
        <div class="brand-name">AstroBlog Manager</div>
      </div>

      <div v-if="project.info" class="project-card">
        <div class="project-name" :title="project.info.path">{{ project.info.name }}</div>
        <div class="project-meta">
          <span class="chip">Astro {{ project.info.astroVersion }}</span>
          <span class="chip">{{ project.info.packageManager }}</span>
        </div>
        <a v-if="project.info.site" class="project-site" href="#" @click.prevent="openSite">{{
          project.info.site
        }}</a>
        <div class="project-stats">
          <span
            ><b>{{ project.info.totalPosts }}</b> 篇文章</span
          >
          <span class="draft-num"
            ><b>{{ project.info.draftCount }}</b> 篇草稿</span
          >
        </div>
        <div class="project-actions">
          <el-button size="small" :icon="Refresh" @click="refreshProject">刷新</el-button>
          <el-button size="small" :icon="Right" @click="openProjectFolder">打开目录</el-button>
        </div>
      </div>

      <div v-if="collections.length > 1" class="section">
        <div class="section-title">内容集合</div>
        <el-radio-group v-model="collectionModel" size="small">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button v-for="c in collections" :key="c.name" :value="c.name">
            {{ c.name }}（{{ c.postCount }}）
          </el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="topTags.length" class="section">
        <div class="section-title">标签筛选</div>
        <div class="tag-cloud">
          <button
            v-for="t in topTags"
            :key="t.name"
            class="tag-chip"
            :class="{ active: posts.tag === t.name }"
            type="button"
            @click="pickTag(t.name)"
          >
            {{ t.name }} <span class="tag-count">{{ t.count }}</span>
          </button>
        </div>
      </div>

      <div class="section draft-switch">
        <el-switch v-model="posts.draftOnly" active-text="仅看草稿" />
      </div>

      <nav class="nav">
        <button class="nav-item" type="button" @click="paletteOpen = true">
          <el-icon><Search /></el-icon>
          快速打开
          <span class="nav-shortcut">Ctrl+P</span>
        </button>
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: isActive(item.path) }"
          type="button"
          @click="router.push(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          {{ item.label }}
        </button>
        <div class="nav-divider"></div>
        <button class="nav-item" type="button" @click="router.push('/welcome')">
          <el-icon><SwitchButton /></el-icon>
          切换项目
        </button>
        <button class="nav-item" type="button" @click="settingsOpen = true">
          <el-icon><Setting /></el-icon>
          设置
        </button>
      </nav>
    </aside>

    <div class="content">
      <header class="topbar">
        <h1 class="topbar-title">{{ route.meta.title }}</h1>
        <div class="topbar-spacer"></div>
        <div class="dev-pill" :class="`dev-${dev.state.status}`">
          <span class="dev-dot"></span>
          开发服务器：{{ devStatusText }}
        </div>
        <el-button
          size="small"
          :type="dev.state.status === 'running' ? 'danger' : 'primary'"
          :icon="
            dev.state.status === 'running' || dev.state.status === 'starting'
              ? VideoPause
              : VideoPlay
          "
          :disabled="dev.state.status === 'stopping'"
          @click="toggleDev"
        >
          {{ dev.state.status === 'running' || dev.state.status === 'starting' ? '停止' : '启动' }}
        </el-button>
        <el-button
          v-if="dev.state.status === 'running'"
          size="small"
          :icon="Right"
          @click="router.push('/preview')"
          >打开预览</el-button
        >
        <div
          v-if="build.state.status !== 'idle'"
          class="dev-pill build-pill"
          :class="`build-${build.state.status}`"
          title="点击查看构建日志"
          @click="buildLogOpen = true"
        >
          <span class="dev-dot"></span>
          构建：{{ buildStatusText }}
        </div>
        <el-button size="small" :loading="build.state.status === 'building'" @click="startBuild"
          >构建</el-button
        >
      </header>
      <main class="view">
        <router-view />
      </main>
    </div>

    <el-dialog v-model="buildLogOpen" title="生产构建（astro build）" width="620px">
      <pre class="build-log">{{ build.state.message || '尚无构建日志' }}</pre>
      <template #footer>
        <el-button
          v-if="build.state.status === 'building'"
          size="small"
          type="danger"
          plain
          @click="build.stop()"
          >取消构建</el-button
        >
        <el-button size="small" @click="buildLogOpen = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="settingsOpen" title="设置" width="420px">
      <el-form label-width="88px" label-position="left">
        <el-form-item label="主题">
          <el-radio-group
            :model-value="settings.theme"
            @update:model-value="settings.setTheme($event as ThemeMode)"
          >
            <el-radio-button value="light">浅色</el-radio-button>
            <el-radio-button value="dark">深色</el-radio-button>
            <el-radio-button value="system">跟随系统</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="编辑器字号">
          <el-slider
            :model-value="settings.editorFontSize"
            :min="12"
            :max="20"
            :step="1"
            show-input
            style="width: 100%"
            @update:model-value="settings.setEditorFontSize($event as number)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="settingsOpen = false">完成</el-button>
      </template>
    </el-dialog>

    <CommandPalette v-model="paletteOpen" />
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 264px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  padding: 14px;
  gap: 14px;
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--brand-gradient);
  color: #fff;
  font-weight: 700;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-name {
  font-weight: 700;
  font-size: 15px;
}

.project-card {
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.project-name {
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  font-size: 11px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  border-radius: 999px;
  padding: 2px 8px;
}
.project-site {
  font-size: 12px;
  color: var(--el-color-primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-site:hover {
  text-decoration: underline;
}
.project-stats {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-sub);
}
.project-stats b {
  color: var(--text-main);
  font-size: 14px;
}
.draft-num b {
  color: #d97706;
}
.project-actions {
  display: flex;
  gap: 8px;
}
.project-actions .el-button {
  flex: 1;
  margin-left: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  font-size: 12px;
  color: var(--text-sub);
  font-weight: 600;
}
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag-chip {
  border: 1px solid var(--border-soft);
  background: var(--bg-card);
  border-radius: 999px;
  font-size: 12px;
  padding: 3px 10px;
  cursor: pointer;
  color: var(--text-main);
}
.tag-chip:hover {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
.tag-chip.active {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}
.tag-count {
  opacity: 0.65;
  font-size: 11px;
}

.draft-switch {
  padding-bottom: 2px;
  border-bottom: 1px solid var(--border-soft);
}

.nav {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 13.5px;
  color: var(--text-main);
  cursor: pointer;
  text-align: left;
}
.nav-item:hover {
  background: var(--el-color-primary-light-9);
}
.nav-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.nav-divider {
  height: 1px;
  background: var(--border-soft);
  margin: 6px 0;
}
.nav-shortcut {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-sub);
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  padding: 1px 5px;
  background: var(--bg-card);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 54px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-soft);
}
.topbar-title {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.topbar-spacer {
  flex: 1;
}

.dev-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-sub);
  background: var(--bg-soft);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
}
.dev-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
}
.dev-running .dev-dot {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}
.dev-starting .dev-dot,
.dev-stopping .dev-dot {
  background: #f59e0b;
  animation: blink 1s infinite;
}
.dev-error .dev-dot {
  background: #ef4444;
}
.build-pill {
  cursor: pointer;
}
.build-building .dev-dot {
  background: #f59e0b;
  animation: blink 1s infinite;
}
.build-done .dev-dot {
  background: #10b981;
}
.build-error .dev-dot {
  background: #ef4444;
}
.build-log {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-main);
  background: var(--bg-soft);
  border-radius: 6px;
  padding: 10px 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}

.view {
  flex: 1;
  overflow: auto;
  padding: 18px;
}
</style>
