/**
 * rehype-imagekit — 为 Markdown 中的远程图片注入 ImageKit CDN 响应式优化
 *
 * 在 unified rehype 阶段遍历 HAST 的 <img> 节点，对匹配配置域名的远程图片：
 * - 将 src 替换为带 tr: 变换参数的 ImageKit 优化 URL
 * - 添加 srcset（多宽度响应式）
 * - 添加 sizes、loading="lazy"、decoding="async"
 *
 * @example
 * // astro.config.mjs
 * import rehypeImageKit from "./src/plugins/rehype-imagekit.mjs";
 * // ...
 * markdown: {
 *   rehypePlugins: [
 *     [rehypeImageKit, {
 *       domains: ["pic.kanochan.net"],
 *       quality: 80,
 *       defaultWidth: 800,
 *       widths: [320, 480, 640, 800, 960, 1280, 1600],
 *     }],
 *   ],
 * }
 */

/**
 * @typedef {Object} ImageKitPluginOptions
 * @property {string[]} [domains]          - 允许处理的域名列表，为空时处理所有远程图片
 * @property {number}  [quality=80]        - 默认输出质量 (1-100)
 * @property {string}  [fit="at_max"]      - 裁剪/填充模式
 * @property {number}  [defaultWidth=800]  - 默认宽度
 * @property {number[]} [widths]           - srcset 宽度断点
 * @property {string}  [sizes]             - 默认 sizes，默认 "(max-width: 768px) 100vw, 800px"
 * @property {string}  [pathPrefix]        - URL 路径前缀，用于确定 tr: 段插入位置
 * @property {boolean} [lazy=true]         - 是否添加 loading="lazy"
 */

/** @type {import('unified').Plugin<[ImageKitPluginOptions?], import('hast').Root>} */
export default function rehypeImageKit(options = {}) {
	const {
		domains = [],
		quality = 80,
		fit = "at_max",
		defaultWidth = 800,
		widths: userWidths,
		sizes: defaultSizes = "(max-width: 768px) 100vw, 800px",
		pathPrefix,
		lazy = true,
	} = options;

	const srcsetWidths = userWidths?.length
		? [...userWidths].sort((a, b) => a - b)
		: [320, 480, 640, 800, 960, 1280, 1600];

	/**
	 * 域名通配符匹配
	 */
	function matchDomain(hostname, pattern) {
		const regex = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
		return new RegExp(`^${regex}$`).test(hostname);
	}

	/**
	 * 判断 URL 是否应被 ImageKit 处理
	 */
	function shouldTransform(urlStr) {
		if (!/^https?:\/\//i.test(urlStr)) return false;
		if (domains.length === 0) return true;
		try {
			const hostname = new URL(urlStr).hostname;
			return domains.some((pattern) => matchDomain(hostname, pattern));
		} catch {
			return false;
		}
	}

	/**
	 * 清理值中的逗号
	 */
	function clean(v) {
		return String(v).replace(/,/g, "").trim();
	}

	/**
	 * 在路径中找到或确定 tr: 段插入位置
	 */
	function buildImageKitPath(pathname, width) {
		const segments = pathname.split("/").filter(Boolean);

		// 检查是否已有 tr: 段（移除旧的）
		const existingIndex = segments.findIndex((s) => s.startsWith("tr:"));
		if (existingIndex >= 0) {
			segments.splice(existingIndex, 1);
		}

		// 确定插入位置
		let insertIndex = 0;
		if (pathPrefix) {
			const normalized = clean(pathPrefix).replace(/^\/+|\/+$/g, "");
			const prefixParts = normalized.split("/").filter(Boolean);
			if (
				prefixParts.length > 0 &&
				segments.length >= prefixParts.length &&
				prefixParts.every((p, i) => segments[i] === p)
			) {
				insertIndex = prefixParts.length;
			}
		}

		const transformParts = [`q-${quality}`, `c-${clean(fit)}`];
		if (width) transformParts.push(`w-${Math.max(1, Math.round(width))}`);

		segments.splice(insertIndex, 0, `tr:${transformParts.join(",")}`);
		return `/${segments.join("/")}`;
	}

	/**
	 * 构建单个 ImageKit 优化 URL
	 */
	function transformUrl(urlStr, width) {
		try {
			const parsed = new URL(urlStr);
			parsed.pathname = buildImageKitPath(parsed.pathname, width);
			return parsed.toString();
		} catch {
			return urlStr;
		}
	}

	return (tree) => {
		visit(tree, "element", (node) => {
			if (node.tagName !== "img") return;
			const src = node.properties?.src;
			if (!src || typeof src !== "string" || !shouldTransform(src)) return;

			const props = /** @type {Record<string, unknown>} */ (node.properties);

			// 替换 src
			props.src = transformUrl(src, defaultWidth);

			// 注入 srcset
			const srcsetParts = srcsetWidths
				.map((w) => `${transformUrl(src, w)} ${w}w`)
				.join(", ");
			props.srcSet = srcsetParts;

			// lightGallery 缩略图：使用最小宽度
			props["data-thumb"] = transformUrl(src, srcsetWidths[0]);
			// lightGallery 灯箱大图：使用最大宽度
			props["data-src"] = transformUrl(
				src,
				srcsetWidths[srcsetWidths.length - 1],
			);

			// 注入 sizes
			if (!props.sizes) {
				props.sizes = defaultSizes;
			}

			// 懒加载
			if (lazy) {
				if (props.loading == null) props.loading = "lazy";
				if (props.decoding == null) props.decoding = "async";
			}
		});
	};
}

/**
 * 简易 HAST 遍历器
 * @param {import('hast').Parent} tree
 * @param {string} type
 * @param {(node: import('hast').Element) => void} fn
 */
function visit(tree, type, fn) {
	if (tree.type === type) fn(/** @type {import('hast').Element} */ (tree));
	if ("children" in tree) {
		for (const child of tree.children) {
			if (child && "type" in child) {
				visit(/** @type {import('hast').Parent} */ (child), type, fn);
			}
		}
	}
}
