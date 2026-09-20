<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Delete, FolderOpened, Right } from '@element-plus/icons-vue'
import { useProjectStore } from '../stores/project'

const router = useRouter()
const project = useProjectStore()
const openingPath = ref<string | null>(null)

const recentItems = computed(() =>
  project.recents.map((p) => ({
    path: p,
    name: p.split(/[\\/]/).filter(Boolean).pop() ?? p
  }))
)

async function selectFolder(): Promise<void> {
  try {
    const info = await project.selectAndOpen()
    if (info) {
      ElMessage.success(`已打开项目：${info.name}`)
      await router.push('/posts')
    }
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function openRecent(path: string): Promise<void> {
  openingPath.value = path
  try {
    const info = await project.openByPath(path)
    ElMessage.success(`已打开项目：${info.name}`)
    await router.push('/posts')
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    openingPath.value = null
  }
}

async function removeRecent(path: string): Promise<void> {
  await project.removeRecent(path)
}

onMounted(() => {
  void project.init()
})
</script>

<template>
  <div class="welcome">
    <div class="hero">
      <div class="hero-logo">A</div>
      <h1 class="hero-title">AstroBlog Manager</h1>
      <p class="hero-sub">选择本地 Astro 博客项目文件夹，即刻管理你的博客文章</p>
      <el-button
        type="primary"
        size="large"
        round
        class="select-btn"
        :icon="FolderOpened"
        :loading="project.opening"
        @click="selectFolder"
      >
        选择 Astro 项目文件夹
      </el-button>
      <p class="hero-hint">支持 Astro 内容集合（src/content）与传统 src/pages 目录结构</p>
    </div>

    <div v-if="recentItems.length" class="recents">
      <div class="recents-title">最近打开</div>
      <div class="recents-list">
        <div v-for="item in recentItems" :key="item.path" class="recent-item panel">
          <div class="recent-info">
            <div class="recent-name">{{ item.name }}</div>
            <div class="recent-path" :title="item.path">{{ item.path }}</div>
          </div>
          <div class="recent-actions">
            <el-button
              type="primary"
              size="small"
              :icon="Right"
              :loading="openingPath === item.path"
              @click="openRecent(item.path)"
              >打开</el-button
            >
            <el-button size="small" :icon="Delete" @click="removeRecent(item.path)">移除</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  height: 100vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  /* 顶部主色光晕 + 右下品牌橙微光，增强欢迎页氛围 */
  background:
    radial-gradient(
      900px 480px at 50% -8%,
      color-mix(in srgb, var(--el-color-primary) 9%, transparent),
      transparent 65%
    ),
    radial-gradient(
      700px 420px at 88% 112%,
      color-mix(in srgb, var(--accent) 7%, transparent),
      transparent 60%
    );
}

.hero {
  text-align: center;
  margin-top: 6vh;
}
.hero-logo {
  width: 84px;
  height: 84px;
  margin: 0 auto 20px;
  border-radius: var(--radius-lg);
  background: var(--brand-gradient);
  color: #fff;
  font-size: 44px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16px 40px color-mix(in srgb, var(--accent) 30%, transparent);
}
.hero-title {
  font-size: 32px;
  margin: 0 0 10px;
  letter-spacing: -0.5px;
  font-weight: 700;
}
.hero-sub {
  color: var(--text-sub);
  margin: 0 0 28px;
  font-size: var(--fs-md);
}
.select-btn {
  height: 46px;
  padding: 0 28px;
  font-size: var(--fs-md);
}
.hero-hint {
  margin-top: 16px;
  font-size: var(--fs-sm);
  color: var(--text-sub);
}

.recents {
  margin-top: 52px;
  width: min(720px, 100%);
}
.recents-title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-sub);
  margin-bottom: 12px;
  text-align: left;
}
.recents-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  transition:
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}
.recent-item:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.recent-info {
  min-width: 0;
}
.recent-name {
  font-weight: 700;
  font-size: var(--fs-base);
}
.recent-path {
  font-size: var(--fs-sm);
  color: var(--text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}
.recent-actions {
  flex-shrink: 0;
  display: flex;
  gap: 0;
}
</style>
