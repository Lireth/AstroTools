<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import MainLayout from './components/MainLayout.vue'
import { useEditorStore } from './stores/editor'

const route = useRoute()
const isBare = computed(() => route.meta.bare === true)
const editor = useEditorStore()

// Alt+F4 / 点击关闭按钮时由主进程转发此事件：
// 无脏状态直接放行；有脏状态先确认（保存并退出 / 放弃修改并退出 / 留下）
async function handleRequestClose(): Promise<void> {
  if (!editor.dirty) {
    await window.api.confirmAppClose()
    return
  }
  try {
    await ElMessageBox.confirm('当前文章有未保存的修改。', '未保存的修改', {
      type: 'warning',
      distinguishCancelAndClose: true,
      confirmButtonText: '保存并退出',
      cancelButtonText: '放弃修改并退出'
    })
  } catch {
    return // 点击 × / Esc → 留在应用
  }
  try {
    await editor.save()
    if (editor.dirty) return // YAML 解析失败等导致保存中止 → 留在应用
  } catch {
    return
  }
  await window.api.confirmAppClose()
}

onMounted(() => {
  window.api.onAppRequestClose(() => {
    void handleRequestClose()
  })
})
</script>

<template>
  <router-view v-if="isBare" />
  <MainLayout v-else />
</template>
