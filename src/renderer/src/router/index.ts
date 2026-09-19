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
    { path: '/welcome', name: 'welcome', component: WelcomeView, meta: { bare: true, title: '选择博客项目' } },
    { path: '/posts', name: 'posts', component: PostListView, meta: { title: '文章管理' } },
    { path: '/editor/:id', name: 'editor', component: PostEditorView, meta: { title: '编辑文章' } },
    { path: '/dashboard', name: 'dashboard', component: DashboardView, meta: { title: '统计' } },
    { path: '/images', name: 'images', component: ImagesView, meta: { title: '图片资源' } },
    { path: '/preview', name: 'preview', component: SitePreviewView, meta: { title: '站点预览' } }
  ]
})

// 未打开项目时只能停留在欢迎页
router.beforeEach((to) => {
  const project = useProjectStore()
  if (!project.info && !to.meta.bare) return { path: '/welcome' }
})

export default router
