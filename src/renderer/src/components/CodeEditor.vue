<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, runScopeHandlers, type Panel } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search'

const props = defineProps<{
  modelValue: string
  readOnly?: boolean
  language?: 'markdown' | 'yaml'
  /** 粘贴/拖入图片时被调用：保存后返回 markdown 引用文本，返回 null 表示放弃 */
  imageHandler?: (file: File) => Promise<string | null>
  /** 暗色主题（跟随应用设置） */
  dark?: boolean
  /** 编辑器字号（px） */
  fontSize?: number
  /** 自动换行（默认开） */
  wordWrap?: boolean
  /** 显示行号（默认开） */
  lineNumbers?: boolean
  /** Tab 缩进宽度（默认 2） */
  tabSize?: number
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const container = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
// 外部同步（加载文章）时的 dispatch 不应触发 dirty 标记
let syncing = false
// 暗色主题/换行/缩进宽度均用 Compartment 动态切换，无需重建编辑器；
// 行号开关为纯视觉项，basicSetup 内置的行号扩展无法摘除，用 CSS 隐藏 gutter 实现
const themeCompartment = new Compartment()
const wrapCompartment = new Compartment()
const tabSizeCompartment = new Compartment()

function languageExtension(): Extension {
  return props.language === 'yaml' ? yamlLang() : markdown({ codeLanguages: languages })
}

/**
 * 中文查找/替换面板（Ctrl+F 唤出，见 extensions 中的 search 配置）。
 * basicSetup 自带的默认面板为英文界面，与应用全中文 UI 不符，故自定义：
 * 输入时同步查询，Enter/Shift+Enter 在匹配间导航，替换框内 Enter 逐个替换。
 */
function makeSearchPanel(view: EditorView): Panel {
  const initial = getSearchQuery(view.state)

  const searchInput = document.createElement('input')
  searchInput.value = initial.search
  searchInput.placeholder = '查找…'
  searchInput.setAttribute('main-field', 'true')

  const replaceInput = document.createElement('input')
  replaceInput.value = initial.replace
  replaceInput.placeholder = '替换为…'

  const applyQuery = (): void => {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: searchInput.value, replace: replaceInput.value })
      )
    })
  }
  const run = (cmd: (v: EditorView) => boolean): void => {
    applyQuery()
    cmd(view)
  }
  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    // 阻止按钮抢占焦点，保持查询输入框的选区
    b.addEventListener('mousedown', (e) => e.preventDefault())
    b.addEventListener('click', onClick)
    return b
  }

  const onEnter = (cmd: (v: EditorView) => boolean) => (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    run(cmd)
  }
  searchInput.addEventListener('input', applyQuery)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      run(findPrevious)
    } else {
      onEnter(findNext)(e)
    }
  })
  replaceInput.addEventListener('keydown', onEnter(replaceNext))

  const dom = document.createElement('div')
  dom.className = 'cm-search-panel'
  // 面板不在 contentDOM 内，keydown 不会进入编辑器 keymap（同内置面板做法）：
  // 在面板 DOM 上跑 search-panel 作用域绑定，让 searchKeymap 的 Esc/F3/Mod-g 生效
  dom.addEventListener('keydown', (e) => {
    if (runScopeHandlers(view, e, 'search-panel')) e.preventDefault()
  })
  dom.append(
    searchInput,
    button('下一个', () => run(findNext)),
    button('上一个', () => run(findPrevious)),
    replaceInput,
    button('替换', () => run(replaceNext)),
    button('全部', () => run(replaceAll)),
    button('关闭', () => closeSearchPanel(view))
  )

  return { dom, top: true, mount: () => searchInput.select() }
}

/** 粘贴/拖入图片：交给 imageHandler 保存并把 markdown 引用插入光标处 */
async function transferImage(event: ClipboardEvent | DragEvent, v: EditorView): Promise<void> {
  const dt = 'clipboardData' in event ? event.clipboardData : event.dataTransfer
  if (!dt || !props.imageHandler) return
  const file = [...dt.files].find((f) => f.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  const markdown = await props.imageHandler(file)
  if (markdown) {
    v.dispatch(v.state.replaceSelection(markdown))
    v.focus()
  }
}

/** 缩进宽度：indentUnit 决定 Tab 键插入/缩进宽度，tabSize 决定制表符渲染宽度 */
function tabSizeExtensions(size: number): Extension[] {
  const n = size === 4 || size === 8 ? size : 2
  return [EditorState.tabSize.of(n), indentUnit.of(' '.repeat(n))]
}

onMounted(() => {
  if (!container.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        // Ctrl+F / Enter / Esc 由 basicSetup 内置的 searchKeymap 处理，
        // 这里仅替换默认面板为中文版；Escape 兜底绑定：面板未开时返回 false 不影响其他按键
        search({ createPanel: makeSearchPanel }),
        keymap.of([{ key: 'Escape', run: closeSearchPanel }]),
        themeCompartment.of(props.dark ? oneDark : []),
        languageExtension(),
        wrapCompartment.of(props.wordWrap === false ? [] : EditorView.lineWrapping),
        tabSizeCompartment.of(tabSizeExtensions(props.tabSize ?? 2)),
        EditorState.readOnly.of(props.readOnly ?? false),
        // 不在组件内绑定 Mod-s：保存是页面级关注点，由宿主的 window keydown 统一处理，
        // 避免组件 keymap + 冒泡到 window 的双重触发
        keymap.of([...defaultKeymap, indentWithTab]),
        EditorView.domEventHandlers({
          paste: (event, v) => {
            void transferImage(event, v)
            return false
          },
          drop: (event, v) => {
            void transferImage(event, v)
            return false
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) {
            emit('update:modelValue', update.state.doc.toString())
          }
        })
      ]
    }),
    parent: container.value
  })
})

watch(
  () => props.dark,
  (dark) => {
    view?.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : []) })
  }
)

watch(
  () => props.wordWrap,
  (wrap) => {
    view?.dispatch({ effects: wrapCompartment.reconfigure(wrap === false ? [] : EditorView.lineWrapping) })
  }
)

watch(
  () => props.tabSize,
  (size) => {
    view?.dispatch({ effects: tabSizeCompartment.reconfigure(tabSizeExtensions(size ?? 2)) })
  }
)

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return
    const current = view.state.doc.toString()
    if (value !== current) {
      syncing = true
      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value }
        })
      } finally {
        syncing = false
      }
    }
  }
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<template>
  <div
    ref="container"
    class="code-editor"
    :class="{ 'hide-gutters': lineNumbers === false }"
    :style="fontSize ? { fontSize: `${fontSize}px` } : undefined"
  ></div>
</template>

<style scoped>
.code-editor {
  height: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
}

/* 行号开关：隐藏整个 gutter 列（行号 + 折叠标记，均为纯视觉元素） */
.code-editor.hide-gutters :deep(.cm-gutters) {
  display: none;
}

/* 中文查找/替换面板（跟随 Element Plus 主题变量，深浅色自适应） */
.code-editor :deep(.cm-search-panel) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
.code-editor :deep(.cm-search-panel input) {
  width: 150px;
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  outline: none;
}
.code-editor :deep(.cm-search-panel input:focus) {
  border-color: var(--el-color-primary);
}
.code-editor :deep(.cm-search-panel button) {
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.code-editor :deep(.cm-search-panel button:hover) {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}
</style>
