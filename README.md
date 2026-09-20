# AstroBlog Manager

一个专门管理 [Astro](https://astro.build) 博客项目的桌面工具（Electron + Vue 3 + TypeScript）。

选择本地的 Astro 博客项目文件夹后，即可在应用内完成日常的博客维护工作，无需再手动翻文件、改 frontmatter。

## 功能

- **项目识别**：自动校验 Astro 项目，读取项目名、Astro 版本、站点地址、包管理器、内容集合与文章统计
- **文章管理**：
  - 自动发现内容集合（兼容 Astro 5 `content.config.ts` 的 glob loader、Astro 4 传统 `src/content/` 目录，回退支持 `src/pages/`）
  - 文章增删查改：新建（frontmatter 模板自动适配当前主题）、编辑、重命名、删除（移入系统回收站，可恢复）
  - Markdown 编辑器（CodeMirror 6）+ 实时渲染预览（markdown-it + highlight.js）
  - frontmatter 表单化编辑，主题专有字段可通过"其他字段"编辑
- **全文搜索 + 筛选**：按标题/正文/标签全文搜索，支持标签筛选、草稿筛选、集合切换
- **批量操作**：多选文章批量发布/转草稿/加标签/删除（自动适配每篇的 frontmatter 键名）
- **死链检查**：扫描站内链接与图片引用，按文章分组展示无效引用
- **命令面板**：`Ctrl+P` 快速搜索文章标题、跳转页面、启停开发服务器
- **统计仪表盘**：文章/草稿/字数概览、近 12 个月发布趋势、标签分布、草稿箱
- **YAML 源码编辑**：frontmatter 支持表单与 YAML 源码两种模式切换
- **图片资源管理**：浏览 `public/` 下全部图片、预览、一键复制 markdown 引用、批量导入图片、移入回收站、查找未被文章/源码引用的图片
- **编辑器插图**：在编辑器中直接粘贴/拖入图片，自动保存到 `public/images/` 并插入 markdown 引用
- **文件监听**：自动检测文章文件的外部修改（git pull、其他编辑器），文章列表实时更新
- **一键构建**：顶栏运行 `astro build` 生产构建，查看进度与日志，支持取消
- **Git 集成**：文章列表显示 git 状态（修改/新增/未跟踪），批量勾选文章一键提交
- **设置**：浅色/深色/跟随系统主题、编辑器字号调节（设置持久化）
- **内嵌预览**：一键启动/停止 Astro 开发服务器，在应用内嵌 webview 中实时预览站点（支持 npm/pnpm/yarn/bun）

## 使用

```bash
npm install
npm run dev     # 启动应用（开发模式）
```

启动后：

1. 点击「选择 Astro 项目文件夹」，选择博客项目根目录（含 `package.json` 与 `astro.config.*`）
2. 在「文章管理」中新建或编辑文章，`Ctrl+S` 保存
3. 顶栏「启动」运行 Astro 开发服务器，切到「站点预览」实时查看效果

## 开发

```bash
npm run typecheck   # 类型检查（node + web 两部分）
npm test            # vitest 单元测试
npm run build       # 构建（out/ 目录）
node tests/e2e/app.e2e.mjs   # E2E 冒烟测试（驱动真实窗口，截图输出到 tests/e2e/screenshots/）
npm run dist        # 打包安装程序（electron-builder，输出 release/）
npm run dist:dir    # 打包免安装目录（快速验证）
```

## 目录结构

```
src/
├── main/        # Electron 主进程：服务层（项目识别/文章CRUD/图片/dev server）+ IPC
├── preload/     # contextBridge 暴露类型化 API
├── renderer/    # Vue 3 渲染层（视图/store/路由）
└── shared/      # 主进程与渲染层共享的类型与 API 契约
tests/           # vitest 单元测试 + fixture 示例博客
```

## 安全说明

- 渲染进程关闭 Node 集成，所有文件操作经 IPC 在主进程完成，且路径校验限制在项目根目录内
- 删除操作使用系统回收站（`shell.trashItem`），不做硬删除
- `media://` 自定义协议仅允许访问当前项目的 `public/` 目录
