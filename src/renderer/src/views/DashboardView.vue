<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePostsStore } from '../stores/posts'

const router = useRouter()
const posts = usePostsStore()

const totalWords = computed(() => posts.posts.reduce((sum, p) => sum + p.bodyLength, 0))
const latestDate = computed(() => posts.posts.find((p) => p.date)?.date ?? null)
const drafts = computed(() => posts.posts.filter((p) => p.draft))

const topTags = computed(() => posts.tagCounts.slice(0, 10))
const maxTagCount = computed(() => topTags.value[0]?.count ?? 1)

// 近 12 个月发布趋势（不含草稿）；文章列表主进程已按日期倒序
const monthTrend = computed(() => {
  const months: { key: string; label: string; count: number }[] = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${d.getMonth() + 1}月`,
      count: 0
    })
  }
  for (const p of posts.posts) {
    const date = p.date
    if (!date || p.draft) continue
    const hit = months.find((m) => m.key === date.slice(0, 7))
    if (hit) hit.count++
  }
  return months
})
const maxMonthCount = computed(() => Math.max(1, ...monthTrend.value.map((m) => m.count)))

function barHeight(count: number, max: number): string {
  return `${Math.max((count / max) * 100, count > 0 ? 6 : 2)}%`
}

function goTag(name: string): void {
  posts.tag = name
  posts.draftOnly = false
  void router.push('/posts')
}

function goDrafts(): void {
  posts.draftOnly = true
  posts.tag = null
  void router.push('/posts')
}

function openEditor(id: string): void {
  void router.push(`/editor/${encodeURIComponent(id)}`)
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

function formatWords(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : String(n)
}

onMounted(() => {
  void posts.load()
})
</script>

<template>
  <div class="dashboard">
    <div class="stat-cards">
      <div class="stat-card panel">
        <div class="stat-icon">
          <el-icon :size="20"><Document /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-num">{{ posts.posts.length }}</div>
          <div class="stat-label">文章总数</div>
        </div>
      </div>
      <div class="stat-card panel">
        <div class="stat-icon warning">
          <el-icon :size="20"><EditPen /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-num">{{ drafts.length }}</div>
          <div class="stat-label">草稿</div>
        </div>
      </div>
      <div class="stat-card panel">
        <div class="stat-icon">
          <el-icon :size="20"><Collection /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-num">{{ formatWords(totalWords) }}</div>
          <div class="stat-label">正文总字数</div>
        </div>
      </div>
      <div class="stat-card panel">
        <div class="stat-icon muted">
          <el-icon :size="20"><Clock /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-num">{{ formatDate(latestDate) }}</div>
          <div class="stat-label">最近发布</div>
        </div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="panel chart-card">
        <div class="card-title">
          发布趋势
          <span class="card-sub">近 12 个月（不含草稿）</span>
        </div>
        <div class="trend">
          <div v-for="m in monthTrend" :key="m.key" class="trend-col">
            <span class="trend-count" :class="{ zero: m.count === 0 }">{{ m.count }}</span>
            <div class="trend-bar-zone">
              <div
                class="trend-bar"
                :style="{ height: barHeight(m.count, maxMonthCount) }"
                :title="`${m.key}：${m.count} 篇`"
              ></div>
            </div>
            <span class="trend-label">{{ m.label }}</span>
          </div>
        </div>
      </div>

      <div class="panel chart-card">
        <div class="card-title">
          标签分布
          <span class="card-sub">Top 10，点击筛选</span>
        </div>
        <div v-if="!topTags.length" class="empty-hint">还没有任何标签</div>
        <div v-else class="tag-bars">
          <button
            v-for="t in topTags"
            :key="t.name"
            class="tag-bar-row"
            type="button"
            @click="goTag(t.name)"
          >
            <span class="tag-bar-name" :title="t.name">{{ t.name }}</span>
            <span class="tag-bar-track">
              <span class="tag-bar" :style="{ width: `${(t.count / maxTagCount) * 100}%` }"></span>
            </span>
            <span class="tag-bar-count">{{ t.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="panel chart-card">
      <div class="card-title">
        草稿箱
        <span class="card-sub">{{ drafts.length }} 篇待发布</span>
        <el-button v-if="drafts.length" size="small" text type="primary" @click="goDrafts">
          查看全部
        </el-button>
      </div>
      <div v-if="!drafts.length" class="empty-hint">没有草稿，全部文章都已发布 🎉</div>
      <div v-else class="draft-list">
        <button
          v-for="p in drafts.slice(0, 5)"
          :key="p.id"
          class="draft-row"
          type="button"
          @click="openEditor(p.id)"
        >
          <span class="draft-title">{{ p.title }}</span>
          <span class="draft-meta">{{ p.collection }} · {{ formatDate(p.date) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  transition:
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}
.stat-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.stat-icon {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.stat-icon.warning {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}
.stat-icon.muted {
  background: var(--bg-soft);
  color: var(--text-sub);
}
.stat-info {
  min-width: 0;
}
.stat-num {
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -0.4px;
  font-variant-numeric: tabular-nums;
  color: var(--text-main);
  line-height: 1.2;
}
.stat-label {
  margin-top: 4px;
  font-size: var(--fs-sm);
  color: var(--text-sub);
}

.dash-grid {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 12px;
}
@media (max-width: 1000px) {
  .dash-grid {
    grid-template-columns: 1fr;
  }
}

.chart-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-base);
  font-weight: 700;
}
.card-sub {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--text-sub);
}
.empty-hint {
  padding: 22px 0;
  text-align: center;
  font-size: var(--fs-base);
  color: var(--text-sub);
}

.trend {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 170px;
}
.trend-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 100%;
}
.trend-count {
  font-size: var(--fs-xs);
  color: var(--text-sub);
}
.trend-count.zero {
  opacity: 0.45;
}
.trend-bar-zone {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.trend-bar {
  width: 60%;
  max-width: 34px;
  min-height: 3px;
  border-radius: 5px 5px 2px 2px;
  background: linear-gradient(180deg, var(--el-color-primary-light-3), var(--el-color-primary));
  transition: height var(--dur-slow) var(--ease-out);
}
.trend-label {
  font-size: var(--fs-xs);
  color: var(--text-sub);
}

.tag-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tag-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.tag-bar-name {
  width: 110px;
  flex-shrink: 0;
  font-size: var(--fs-sm);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-bar-row:hover .tag-bar-name {
  color: var(--el-color-primary);
}
.tag-bar-track {
  flex: 1;
  height: 12px;
  border-radius: var(--radius-full);
  background: var(--el-color-primary-light-9);
  overflow: hidden;
}
.tag-bar {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  transition: width var(--dur-slow) var(--ease-out);
}
.tag-bar-count {
  width: 28px;
  text-align: right;
  font-size: var(--fs-sm);
  color: var(--text-sub);
  flex-shrink: 0;
}

.draft-list {
  display: flex;
  flex-direction: column;
}
.draft-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: none;
  background: transparent;
  padding: 9px 4px;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px solid var(--border-soft);
}
.draft-row:last-child {
  border-bottom: none;
}
.draft-row:hover .draft-title {
  color: var(--el-color-primary);
}
.draft-title {
  font-size: var(--fs-base);
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.draft-meta {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  color: var(--text-sub);
}
</style>
