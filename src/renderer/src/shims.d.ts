// 全局脚本式类型补充（无 import/export，作为 ambient 声明生效）

declare module 'markdown-it-task-lists' {
  const plugin: (md: unknown, options?: Record<string, unknown>) => void
  export default plugin
}
