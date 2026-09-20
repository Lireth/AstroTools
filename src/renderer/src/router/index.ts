import { createRouter, createWebHashHistory } from 'vue-router'
import { useProjectStore } from '../stores/project'
import WelcomeView from '../views/WelcomeView.vue'
import PostListView from '../views/PostListView.vue'
import PostEditorView from '../views/PostEditorView.vue'
import DashboardView from '../views/DashboardView.vue'
import ImagesView from '../views/ImagesView.vue'
import SitePreviewView from '../views/SitePreviewView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/posts' },
    {
      path: '/welcome',
      name: 'welcome',
      component: WelcomeView,
      meta: { bare: true, title: '选择博客项目' }
    },
    { path: '/posts', name: 'posts', component: PostListView, meta: { title: '文章管理' } },
    { path: '/editor/:id', name: 'editor', component: PostEditorView, meta: { title: '编辑文章' } },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { title: '统计' } },
    { path: '/images', name: 'images', component: ImagesView, meta: { title: '图片资源' } },
    { path: '/preview', name: 'preview', component: SitePreviewView, meta: { title: '站点预览' } }
  ]
})

// 未打开项目时只能停留在欢迎页。
// 渲染层重载（崩溃/刷新恢复）时主进程可能仍持有打开的项目：
// 首次被拦截的导航先尝试从主进程恢复会话，恢复失败才回落到欢迎页。
let restoreAttempted = false

router.beforeEach(async (to) => {
  const project = useProjectStore()
  if (project.info || to.meta.bare) return true
  if (!restoreAttempted) {
    restoreAttempted = true
    await project.restore()
  }
  if (!project.info && !to.meta.bare) return { path: '/welcome' }
})

export default router
