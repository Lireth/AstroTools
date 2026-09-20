<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import taskLists from 'markdown-it-task-lists'
import 'highlight.js/styles/github.css'

const props = defineProps<{ source: string }>()

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(code, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // 高亮失败则退回转义输出
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`
  }
})

md.use(taskLists)

// 站点绝对路径引用的图片映射到 media:// 协议（编辑器内不依赖 dev server 也能看图）
const defaultImage =
  md.renderer.rules.image ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src')
  if (src && /^\/[^/]/.test(src)) {
    token.attrSet('src', `media://local/${src.slice(1).split('/').map(encodeURIComponent).join('/')}`)
  }
  return defaultImage(tokens, idx, options, env, self)
}

// 链接统一在新窗口打开（webview 内阻止导航）
const defaultLink =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noreferrer')
  return defaultLink(tokens, idx, options, env, self)
}

// 渲染防抖：每个按键都全量 md.render 在长文下会掉帧。
// 首次加载（当前为空）立即渲染；连续输入时 250ms 防抖后再渲染。
const rendered = ref(props.source)
let debounceTimer: number | undefined
watch(
  () => props.source,
  (value) => {
    if (!rendered.value) {
      rendered.value = value
      return
    }
    window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      rendered.value = value
    }, 250)
  }
)
onBeforeUnmount(() => window.clearTimeout(debounceTimer))

const html = computed(() => md.render(rendered.value))

function onPreviewClick(e: MouseEvent): void {
  const anchor = (e.target as HTMLElement).closest('a')
  if (anchor) e.preventDefault()
}
</script>

<template>
  <div class="md-preview" @click="onPreviewClick" v-html="html"></div>
</template>
