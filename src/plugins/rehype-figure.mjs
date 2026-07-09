import { h } from "hastscript";
import { visit } from "unist-util-visit";
import {
	buildImageKitSrcSet,
	buildImageKitUrl,
	getRemoteImageSizes,
	getRemoteImageWidths,
	shouldAddNoReferrer,
	shouldUseImageKitForUrl,
} from "../utils/image-utils.ts";

/**
 * 将带有 alt 文本的图片转换为包含 figcaption 的 figure 元素的 rehype 插件
 *
 * @returns {Function} A transformer function for the rehype plugin
 */
export default function rehypeFigure() {
	return (tree) => {
		visit(tree, "element", (node, index, parent) => {
			// 只处理 img 元素
			if (node.tagName !== "img") {
				return;
			}

			// 跳过已由其它插件接管渲染的图片（例如 plantuml）
			const classRaw = node.properties?.className;
			const classNames = Array.isArray(classRaw)
				? classRaw
				: typeof classRaw === "string"
					? classRaw.split(/\s+/)
					: [];
			if (classNames.includes("plantuml-image")) {
				return;
			}

			const imgProps = { ...node.properties };
			const src = typeof imgProps.src === "string" ? imgProps.src : "";

			if (src && shouldUseImageKitForUrl(src)) {
				const widths = getRemoteImageWidths();
				const fallbackWidth = widths[Math.floor(widths.length / 2)] || 960;
				imgProps.src = buildImageKitUrl(src, { width: fallbackWidth });
				imgProps.srcset = buildImageKitSrcSet(src, widths);
				imgProps.sizes = getRemoteImageSizes();
				// lightGallery：最大宽度作灯箱大图，最小宽度作缩略图
				const maxW = widths[widths.length - 1];
				const minW = widths[0];
				if (maxW) imgProps["data-src"] = buildImageKitUrl(src, { width: maxW });
				if (minW) imgProps["data-thumb"] = buildImageKitUrl(src, { width: minW });
			}

			// 添加 referrerpolicy（如果需要）解决 403 问题
			// 无论是否有 alt，都要检查并添加 referrerpolicy
			if (imgProps.src && shouldAddNoReferrer(imgProps.src)) {
				imgProps.referrerpolicy = "no-referrer";
			}

			// 获取 alt 属性
			const alt = imgProps.alt;

			// 如果没有 alt 属性或 alt 为空字符串，则只更新属性并保持原样
			if (!alt || alt.trim() === "") {
				node.properties = imgProps;
				return;
			}

			// 创建 figure 元素，包含处理后的 img 和居中的 figcaption
			// lightGallery 属性放在 figure 上，避免 lightGallery 对 <img> 忽略 data-src
			const figure = h("figure", {
				"data-src": imgProps["data-src"],
				"data-thumb": imgProps["data-thumb"],
			}, [
				h("img", {
					...imgProps,
				}),
				h("figcaption", alt),
			]);

			// 居中显示
			const centerFigure = h("center", figure);

			// 替换当前的 img 节点为 figure 节点
			if (parent && typeof index === "number") {
				parent.children[index] = centerFigure;
			}
		});
	};
}
