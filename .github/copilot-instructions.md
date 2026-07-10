# Project Guidelines

Firefly 是一个基于 **Astro 6** + **Svelte 5** 的功能丰富的静态博客主题，是 [Fuwari](https://github.com/saicaca/fuwari) 的 fork。主要语言为简体中文，支持 en、zh_TW、ja、ru 多语言。

## Package Manager

使用 **pnpm** 作为包管理器，Node.js >= 22。

## Commands

| 命令 | 用途 |
|---|---|
| `pnpm dev` | 启动开发服务器 `localhost:4321` |
| `pnpm build` | 生产构建（icons → LQIPs → Astro build → Pagefind 索引） |
| `pnpm preview` | 预览生产构建 |
| `pnpm check` | Astro 类型/错误检查 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm lint` | Biome 检查 + 自动修复 |
| `pnpm format` | Biome 格式化 |
| `pnpm new-post <filename>` | 创建新博客文章 |

## Code Style

- **Biome** 强制执行：tab 缩进、双引号、推荐 lint 规则
- `.svelte` / `.astro` 文件放宽规则（useConst off、noUnusedVariables off）
- 提交规范：**Conventional Commits**（`feat:`、`fix:`、`chore:` 等）

## Architecture

### Astro + Svelte 混合

- `.astro` 组件用于静态内容和布局
- `.svelte` 组件用于交互式 UI（搜索、设置、分页、归档），使用 `client:load` 或 `client:visible` 挂载
- Swup.js 处理类 SPA 页面过渡

### 配置驱动

所有功能通过 `src/config/` 中的 TypeScript 文件配置，通过桶文件 `src/config/index.ts` 导出。关键配置见该目录。

### 布局系统

- `Layout.astro` — HTML 外壳（head、body、主题初始化、分析、Swup 钩子）
- `MainGridLayout.astro` — 全页网格布局（侧边栏、导航栏、壁纸、页脚）

### 内容集合

定义在 `src/content.config.ts`：
- `posts` — 博客文章（`.md`/`.mdx`），frontmatter：title、published、tags、category、draft、pinned、password、comment 等
- `spec` — 特殊页面（about、guestbook）

### 路径别名

`@components/*`、`@assets/*`、`@constants/*`、`@utils/*`、`@i18n/*`、`@layouts/*` → `./src/<dir>/*`；`@/*` → `./src/*`

### 关键目录

- `src/components/` — 按领域组织：`analytics/`、`comment/`、`common/`、`controls/`、`features/`、`layout/`、`misc/`、`pages/`、`widget/`
- `src/plugins/` — 15 个自定义 remark/rehype 插件
- `src/i18n/` — 翻译键在 `i18nKey.ts`，语言文件在 `languages/*.ts`
- `src/utils/` — 内容排序、加密文章、日期格式化、图片处理/LQIP、TOC 生成
- `scripts/` — 构建时工具

## Build Pipeline

多步骤：`scripts/generate-icons.js` → `scripts/generate-lqips.ts` → `astro build` → `pagefind --site dist`

Icons/LQIP 数据生成到 `src/constants/` 并提交。可用 `pnpm icons` 或 `pnpm lqips` 重新生成。

## Deployment

- **Vercel**（默认，`vercel.json`）
- **Cloudflare Workers**（`wrangler.jsonc`，设置 `CF_WORKERS` 环境变量）
- 静态输出至 `dist/`
