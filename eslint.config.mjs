import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}']
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/release/**', '**/screenshots/**']
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  // 格式类规则交给 Prettier，避免双重风格冲突
  skipFormatting,
  {
    name: 'app/custom-rules',
    rules: {
      'vue/multi-word-component-names': 'off',
      // Electron 主/preload 代码使用默认导出与生命周期副作用，属既有约定
      'vue/html-self-closing': 'off'
    }
  }
)
