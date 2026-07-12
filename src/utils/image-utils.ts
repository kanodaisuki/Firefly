import { coverImageConfig } from "../config/coverImageConfig";
import { siteConfig } from "../config/siteConfig";
import type { ImageFormat } from "../types/config";

const { randomCoverImage } = coverImageConfig;

/**
 * 根据seed生成确定性hash值
 */
function getSeedHash(seed?: string): number {
	return seed
		? Math.abs(
				seed.split("").reduce((acc, char) => {
					return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
				}, 0),
			)
		: 0;
}

/**
 * 为API URL添加seed参数，确保每篇文章获取不同图片
 */
function appendSeedParam(apiUrl: string, hash: number): string {
	if (hash === 0) return apiUrl;
	const separator = apiUrl.includes("?") ? "&" : "?";
	return `${apiUrl}${separator}v=${hash}`;
}

/**
 * 处理文章封面图
 * 当image字段为"api"时，返回第一个API的URL（客户端会按顺序尝试所有API）
 * @param image - 文章frontmatter中的image字段值
 * @param seed - 用于生成唯一URL的种子（文章id或slug）
 */
export function processCoverImageSync(
	image: string | undefined,
	seed?: string,
): string {
	if (!image || image === "") {
		return "";
	}

	if (image !== "api") {
		return image;
	}

	if (
		!randomCoverImage.enable ||
		!randomCoverImage.apis ||
		randomCoverImage.apis.length === 0
	) {
		return "";
	}

	// 始终使用第一个API，失败时由客户端按顺序尝试后续API
	const hash = getSeedHash(seed);
	return appendSeedParam(randomCoverImage.apis[0], hash);
}

/**
 * 获取所有随机封面图API URL列表（带seed参数）
 * 用于客户端按顺序尝试，第一个成功即使用，全部失败则显示回退图片
 * @param image - 文章frontmatter中的image字段值
 * @param seed - 用于生成唯一URL的种子（文章id或slug）
 */
export function getApiUrlList(
	image: string | undefined,
	seed?: string,
): string[] {
	if (image !== "api" || !randomCoverImage.enable || !randomCoverImage.apis) {
		return [];
	}

	const hash = getSeedHash(seed);
	return randomCoverImage.apis.map((api) => appendSeedParam(api, hash));
}

/**
 * 获取图片优化格式配置
 */
export function getImageFormats(): ImageFormat[] {
	const formatConfig = siteConfig.imageOptimization?.formats ?? "both";
	switch (formatConfig) {
		case "avif":
			return ["avif"];
		case "webp":
			return ["webp"];
		default:
			return ["avif", "webp"];
	}
}

/**
 * 获取图片优化质量配置
 */
export function getImageQuality(): number {
	return siteConfig.imageOptimization?.quality ?? 80;
}

/**
 * 获取图片回退格式
 */
export function getFallbackFormat(): "avif" | "webp" {
	const formatConfig = siteConfig.imageOptimization?.formats ?? "both";
	return formatConfig === "avif" ? "avif" : "webp";
}

/**
 * 检查是否需要为图片添加 referrerpolicy="no-referrer" 以解决防盗链 403 问题
 */
export function shouldAddNoReferrer(urlStr: string): boolean {
	if (!urlStr.startsWith("http")) return false;
	const domains = siteConfig.imageOptimization?.noReferrerDomains || [];
	if (domains.length === 0) return false;
	try {
		const hostname = new URL(urlStr).hostname;
		return domains.some((pattern) => {
			// 先完整转义正则元字符，再把用户写的 * 通配符还原为 .*
			const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regexPattern = escaped.replace(/\\\*/g, ".*");
			return new RegExp(`^${regexPattern}$`).test(hostname);
		});
	} catch {
		return false;
	}
}

type BuildRemoteResponsiveImageOptions = {
	widths?: number[];
	sizes?: string;
	layout?: string;
	formats?: ImageFormat[];
	maxWidth?: number;
	fallbackWidth?: number;
};

export type RemoteResponsiveImageResult = {
	useImageKit: boolean;
	src: string;
	srcset?: string;
	sizes: string;
	avifSrcSet?: string;
	webpSrcSet?: string;
	widths: number[];
	fallbackWidth: number;
};

function matchDomainWithWildcard(hostname: string, pattern: string): boolean {
	const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
	return new RegExp(`^${regexPattern}$`).test(hostname);
}

function findImageKitTransformIndex(segments: string[]): number {
	return segments.findIndex((segment) => segment.startsWith("tr:"));
}

function findInsertIndexByPathPrefix(
	segments: string[],
	pathPrefix?: string,
): number {
	if (!pathPrefix) return 0;
	const normalizedPrefix = sanitizeImageKitValue(pathPrefix).replace(
		/^\/+|\/+$/g,
		"",
	);
	if (!normalizedPrefix) return 0;

	const prefixSegments = normalizedPrefix.split("/").filter(Boolean);
	if (prefixSegments.length === 0 || segments.length < prefixSegments.length) {
		return 0;
	}

	const isPrefixMatched = prefixSegments.every(
		(prefixSegment, index) => segments[index] === prefixSegment,
	);

	return isPrefixMatched ? prefixSegments.length : 0;
}

function sanitizeImageKitValue(value: string): string {
	return value.replace(/,/g, "").trim();
}

/**
 * 当前 URL 是否应由 ImageKit 组件层优化流程处理
 */
export function shouldUseImageKitForUrl(urlStr: string): boolean {
	const imagekit = siteConfig.imageOptimization?.imagekit;
	if (!imagekit?.enabled) return false;
	if (!urlStr.startsWith("http")) return false;

	try {
		const hostname = new URL(urlStr).hostname;
		const domains = imagekit.domains || [];
		if (domains.length === 0) return true;
		return domains.some((pattern) =>
			matchDomainWithWildcard(hostname, pattern),
		);
	} catch {
		return false;
	}
}

/**
 * 获取远程图片默认响应式宽度列表
 * 从 transforms 配置中提取所有宽度值，未配置时使用默认列表
 * 宽度排序为升序，确保响应式 srcset 中的宽度顺序正确
 */
export function getRemoteImageWidths(): number[] {
	const transforms = siteConfig.imageOptimization?.imagekit?.transforms;
	if (transforms && transforms.length > 0) {
		return transforms.map((t) => t.width).sort((a, b) => a - b);
	}
	return [320, 480, 640, 800, 960, 1280, 1600];
}

/**
 * 获取远程图片默认 sizes
 */
export function getRemoteImageSizes(layout?: string): string {
	const configured = siteConfig.imageOptimization?.imagekit?.sizes;
	if (configured) return configured;

	if (layout === "full-width") {
		return "100vw";
	}

	return "(max-width: 768px) 100vw, (max-width: 1200px) 90vw, 1200px";
}

/**
 * 从 transforms 列表中按宽度查找对应的变换规则
 *
 * 优先精确匹配，若无精确匹配则选择不小于目标宽度的最小可用宽度
 * （即向上取整），确保图片清晰度不会因缩放而损失。
 * 若目标宽度超过所有可用宽度，则使用最大宽度。
 */
function findTransformRule(
	width: number,
	transforms?: { width: number; transformRule: string }[],
): string {
	if (!transforms || transforms.length === 0) {
		throw new Error(
			`ImageKit transforms 未配置，无法处理宽度为 ${width} 的图片`,
		);
	}
	// 精确匹配
	const exact = transforms.find((t) => t.width === width);
	if (exact) return exact.transformRule;

	// 向上取整：找不小于目标宽度的最小宽度
	const sorted = [...transforms].sort((a, b) => a.width - b.width);
	const ceil = sorted.find((t) => t.width >= width);
	if (ceil) return ceil.transformRule;

	// 目标宽度超过所有配置，使用最大宽度
	const max = sorted[sorted.length - 1];
	return max.transformRule;
}

/**
 * 基于 ImageKit 路径转换规则构造优化后的远程 URL
 *
 * 根据目标宽度在 transforms 列表中查找对应的变换规则，
 * 将完整的 transformRule 直接作为路径段插入 URL。
 * 若宽度未指定则返回原始 URL，若宽度未配置则抛出错误。
 */
export function buildImageKitUrl(
	urlStr: string,
	options: {
		width?: number;
		height?: number;
		dpr?: 1 | 2;
	} = {},
): string {
	if (!shouldUseImageKitForUrl(urlStr)) {
		return urlStr;
	}

	// 未指定宽度时不做变换
	if (options.width == null) return urlStr;

	const imagekit = siteConfig.imageOptimization?.imagekit;
	const transformRule = findTransformRule(
		Math.max(1, Math.round(options.width)),
		imagekit?.transforms,
	);
	const transformSegment = sanitizeImageKitValue(transformRule);

	try {
		const parsed = new URL(urlStr);
		const pathSegments = parsed.pathname.split("/").filter(Boolean);

		const transformIndex = findImageKitTransformIndex(pathSegments);
		if (transformIndex >= 0) {
			pathSegments[transformIndex] = transformSegment;
		} else {
			const insertIndex = findInsertIndexByPathPrefix(
				pathSegments,
				imagekit?.pathPrefix,
			);
			pathSegments.splice(insertIndex, 0, transformSegment);
		}

		parsed.pathname = `/${pathSegments.join("/")}`;
		return parsed.toString();
	} catch {
		return urlStr;
	}
}

/**
 * 生成远程响应式 srcset
 */
export function buildImageKitSrcSet(urlStr: string, widths: number[]): string {
	const validWidths = widths
		.map((width) => Math.round(width))
		.filter((width) => Number.isFinite(width) && width > 0)
		.sort((a, b) => a - b);

	if (validWidths.length === 0) return "";

	return validWidths
		.map((width) => {
			const transformed = buildImageKitUrl(urlStr, { width });
			return `${transformed} ${width}w`;
		})
		.join(", ");
}

function normalizeWidths(widths?: number[]): number[] {
	const sourceWidths =
		widths && widths.length > 0 ? widths : getRemoteImageWidths();
	return sourceWidths
		.map((width) => Math.round(width))
		.filter((width) => Number.isFinite(width) && width > 0)
		.sort((a, b) => a - b);
}

/**
 * 统一构建远程图片响应式结果，用于文章与相册组件复用。
 */
export function buildRemoteResponsiveImage(
	urlStr: string,
	options: BuildRemoteResponsiveImageOptions = {},
): RemoteResponsiveImageResult {
	const useImageKit = shouldUseImageKitForUrl(urlStr);
	const requestedWidths = normalizeWidths(options.widths);
	const maxWidth = options.maxWidth;
	const widths =
		typeof maxWidth === "number" && maxWidth > 0
			? requestedWidths.filter((width) => width <= maxWidth)
			: requestedWidths;
	const effectiveWidths = widths.length > 0 ? widths : requestedWidths;
	const fallbackWidth =
		typeof options.fallbackWidth === "number" && options.fallbackWidth > 0
			? Math.round(options.fallbackWidth)
			: effectiveWidths.length > 0
				? effectiveWidths[Math.floor(effectiveWidths.length / 2)]
				: 960;
	const sizes = options.sizes || getRemoteImageSizes(options.layout);
	const formats = options.formats || getImageFormats();

	if (!useImageKit) {
		return {
			useImageKit,
			src: urlStr,
			sizes,
			widths: effectiveWidths,
			fallbackWidth,
		};
	}

	const src = buildImageKitUrl(urlStr, { width: fallbackWidth });
	const srcset =
		effectiveWidths.length > 0
			? buildImageKitSrcSet(urlStr, effectiveWidths)
			: undefined;
	const avifSrcSet =
		formats.includes("avif") && effectiveWidths.length > 0
			? buildImageKitSrcSet(urlStr, effectiveWidths)
			: undefined;
	const webpSrcSet =
		formats.includes("webp") && effectiveWidths.length > 0
			? buildImageKitSrcSet(urlStr, effectiveWidths)
			: undefined;

	return {
		useImageKit,
		src,
		srcset,
		sizes,
		avifSrcSet,
		webpSrcSet,
		widths: effectiveWidths,
		fallbackWidth,
	};
}

/**
 * 构建灯箱等场景使用的高分辨率远程图片 URL。
 */
export function buildRemoteLightboxImageUrl(
	urlStr: string,
	options: {
		widths?: number[];
		width?: number;
	} = {},
): string {
	if (!shouldUseImageKitForUrl(urlStr)) return urlStr;

	const widths = normalizeWidths(options.widths);
	const width =
		typeof options.width === "number" && options.width > 0
			? Math.round(options.width)
			: widths.length > 0
				? widths[widths.length - 1]
				: 1600;

	return buildImageKitUrl(urlStr, { width });
}
