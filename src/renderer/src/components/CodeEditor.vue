<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'

const props = defineProps<{ modelValue: string; readOnly?: boolean; language?: 'markdown' | 'yaml' }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void; (e: 'save'): void }>()

const container = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
// 外部同步（加载文章）时的 dispatch 不应触发 dirty 标记
let syncing = false

function languageExtension(): Extension {
  return props.language === 'yaml' ? yamlLang() : markdown({ codeLanguages: languages })
}

onMounted(() => {
  if (!container.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        languageExtension(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(props.readOnly ?? false),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              emit('save')
              return true
            }
          }
        ]),
        keymap.of([...defaultKeymap, indentWithTab]),
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
  <div ref="container" class="code-editor"></div>
</template>

<style scoped>
.code-editor {
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
}
</style>
