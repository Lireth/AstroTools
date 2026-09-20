<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { PostMeta } from '@shared/types'
import { useDevServerStore } from '../stores/devServer'
import { usePostsStore } from '../stores/posts'
import { useProjectStore } from '../stores/project'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const router = useRouter()
const posts = usePostsStore()
const project = useProjectStore()
const dev = useDevServerStore()

const query = ref('')
const activeIndex = ref(0)

interface PaletteAction {
  key: string
  label: string
  run: () => unknown
}

const actions = computed<PaletteAction[]>(() => {
  const list: PaletteAction[] = [
    { key: 'nav-posts', label: '新建文章 / 文章管理', run: () => router.push('/posts') },
    { key: 'nav-images', label: '打开图片资源', run: () => router.push('/images') },
    { key: 'nav-dashboard', label: '打开统计仪表盘', run: () => router.push('/dashboard') },
    { key: 'nav-preview', label: '打开站点预览', run: () => router.push('/preview') },
    {
      key: 'dev-toggle',
      label:
        dev.state.status === 'running' || dev.state.status === 'starting'
          ? '停止开发服务器'
          : '启动开发服务器',
      run: async () => {
        try {
          if (dev.state.status === 'running' || dev.state.status === 'starting') await dev.stop()
          else await dev.start()
        } catch (err) {
          ElMessage.error((err as Error).message)
        }
      }
    },
    {
      key: 'proj-refresh',
      label: '刷新项目信息',
      run: () => project.refresh()
    },
    { key: 'proj-switch', label: '切换项目', run: () => router.push('/welcome') }
  ]
  const q = query.value.trim().toLowerCase()
  return q ? list.filter((a) => a.label.toLowerCase().includes(q)) : list
})

const postHits = computed<PostMeta[]>(() => {
  // 复用主进程生成的全文索引（标题/正文/标签/描述），多词 AND 匹配
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return posts.posts.slice(0, 6)
  return posts.posts.filter((p) => terms.every((t) => p.searchText.includes(t))).slice(0, 8)
})

interface PaletteRow {
  key: string
  kind: 'post' | 'action'
  label: string
  hint: string
  enter: () => void
}

const rows = computed<PaletteRow[]>(() => [
  ...postHits.value.map((p) => ({
    key: `p:${p.id}`,
    kind: 'post' as const,
    label: p.title,
    hint: `${p.collection} · ${p.draft ? '草稿' : '已发布'}`,
    enter: () => {
      void router.push(`/editor/${encodeURIComponent(p.id)}`)
    }
  })),
  ...actions.value.map((a) => ({
    key: `a:${a.key}`,
    kind: 'action' as const,
    label: a.label,
    hint: '操作',
    enter: () => {
      void a.run()
    }
  }))
])

watch([query, () => props.modelValue], () => {
  activeIndex.value = 0
})

// 打开时确保文章数据已加载（未加载过则拉取，用于空查询时展示最近文章）
watch(
  () => props.modelValue,
  (open) => {
    if (open && !posts.loaded) void posts.load()
  }
)

function close(): void {
  emit('update:modelValue', false)
  query.value = ''
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, Math.max(rows.value.length - 1, 0))
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const row = rows.value[activeIndex.value]
    if (!row) return
    close()
    row.enter()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}
</script>

<template>
  <teleport to="body">
    <div v-if="modelValue" class="palette-mask" @mousedown.self="close">
      <div class="palette panel">
        <input
          v-model="query"
          class="palette-input"
          placeholder="搜索文章标题，或输入命令…"
          @keydown="onInputKeydown"
        />
        <div class="palette-list">
          <template v-if="rows.length">
            <button
              v-for="(row, i) in rows"
              :key="row.key"
              class="palette-row"
              :class="{ active: i === activeIndex }"
              type="button"
              @mouseenter="activeIndex = i"
              @click="
                row.enter()
                close()
              "
            >
              <span class="palette-label">{{ row.label }}</span>
              <span class="palette-hint" :class="row.kind">{{ row.hint }}</span>
            </button>
          </template>
          <div v-else class="palette-empty">没有匹配的文章或命令</div>
        </div>
        <div class="palette-footer">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(30, 27, 55, 0.32);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}
.palette {
  width: min(560px, calc(100vw - 48px));
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 50px rgba(30, 27, 55, 0.25);
}
.palette-input {
  border: none;
  outline: none;
  padding: 15px 18px;
  font-size: 15px;
  color: var(--text-main);
  border-bottom: 1px solid var(--border-soft);
  background: transparent;
}
.palette-list {
  max-height: 46vh;
  overflow: auto;
  padding: 6px;
}
.palette-row {
  width: 100%;
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
.palette-row.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.palette-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-hint {
  flex-shrink: 0;
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
  color: var(--text-sub);
  background: var(--border-soft);
}
.palette-hint.post {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.palette-empty {
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-sub);
}
.palette-footer {
  flex-shrink: 0;
  padding: 8px 16px;
  font-size: 11.5px;
  color: #9aa0b0;
  border-top: 1px solid var(--border-soft);
  background: var(--bg-panel-alt);
}
</style>
