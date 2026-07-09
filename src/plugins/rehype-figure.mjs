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
				if (minW)
					imgProps["data-thumb"] = buildImageKitUrl(src, { width: minW });
			}

			// 添加 referrerpolicy（如果需要）解决 403 问题
			// 无论是否有 alt，都要检查并添加 referrerpolicy
			if (imgProps.src && shouldAddNoReferrer(imgProps.src)) {
				imgProps.referrerpolicy = "no-referrer";
			}

			// 获取 alt 属性
			const alt = imgProps.alt;

			// 提取 lightGallery 属性到外层 wrapper div，img 自身不再携带 data-src/data-thumb
			// 若无 ImageKit 高分辨率版本，则回退到当前 src
			const lgSrc = imgProps["data-src"] || src;
			const lgThumb = imgProps["data-thumb"] || imgProps.src || src;
			delete imgProps["data-src"];
			delete imgProps["data-thumb"];

			// 构建包裹 <img> 的 div，data-src/data-thumb 放在此 div 上（与相册 PhotoCard 一致）
			const wrapperDiv = h(
				"div",
				{
					"data-src": lgSrc,
					"data-thumb": lgThumb,
				},
				[h("img", { ...imgProps })],
			);

			if (parent && typeof index === "number") {
				if (alt && alt.trim() !== "") {
					// 有 alt：包裹在 figure > div + figcaption 中，居中显示
					const figure = h("figure", {}, [wrapperDiv, h("figcaption", alt)]);
					parent.children[index] = h("center", figure);
				} else {
					// 无 alt：直接用 wrapper div 替换 img
					parent.children[index] = wrapperDiv;
				}
			}
		});
	};
}
