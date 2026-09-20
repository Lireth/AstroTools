<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

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
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

const container = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
// 外部同步（加载文章）时的 dispatch 不应触发 dirty 标记
let syncing = false
// 暗色主题用 Compartment 动态切换，无需重建编辑器
const themeCompartment = new Compartment()

function languageExtension(): Extension {
  return props.language === 'yaml' ? yamlLang() : markdown({ codeLanguages: languages })
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

onMounted(() => {
  if (!container.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        themeCompartment.of(props.dark ? oneDark : []),
        languageExtension(),
        EditorView.lineWrapping,
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
  <div ref="container" class="code-editor" :style="fontSize ? { fontSize: `${fontSize}px` } : undefined"></div>
</template>

<style scoped>
.code-editor {
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
}
</style>
