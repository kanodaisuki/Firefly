/**
 * ImageKit 外部图片服务
 *
 * 为 Astro 提供 ImageKit CDN 图片处理支持，自动将符合条件的远程图片 URL
 * 转换为 ImageKit 的变换 URL，支持裁剪、格式转换、质量压缩等操作。
 *
 * @module imagekit-image-service
 */

import sharpService from "astro/assets/services/sharp";
import type { AstroConfig, ExternalImageService, ImageTransform } from "astro";

/**
 * ImageKit 服务配置项
 *
 * @see https://docs.imagekit.io/features/image-transformations
 */
type ImageKitServiceConfig = {
	/** 是否启用 ImageKit 图片处理，默认 `false` */
	enabled?: boolean;
	/** 允许处理的域名列表，支持 `*` 通配符。为空时处理所有远程域名 */
	domains?: string[];
	/** URL 路径前缀，用于确定 `tr:` 变换段的插入位置 */
	pathPrefix?: string;
	/** 图片裁剪/填充模式 */
	fit?: "at_max" | "maintain_ratio" | "pad_resize" | "force";
	/** 默认输出质量 (1-100) */
	quality?: number;
	/** 是否启用 AVIF 格式输出 */
	enableAvif?: boolean;
	/** 无法获取远程尺寸时的默认宽度回退值 */
	defaultWidth?: number;
	/** 无法获取远程尺寸时的默认高度回退值 */
	defaultHeight?: number;
	/** 按宽度映射的自定义变换模板，支持 `{width}`、`{height}`、`{quality}`、`{fit}`、`{format}` 占位符 */
	transformsByWidth?: Record<string, string>;
};

/** Astro 图片配置类型别名 */
type ImageConfig = AstroConfig["image"];

/**
 * 清理 URL 路径段，移除逗号并去除空白
 *
 * @param value - 原始路径段字符串
 * @returns 清理后的字符串
 */
function sanitizeSegment(value: string): string {
	return value.replace(/,/g, "").trim();
}

/**
 * 将 ImageTransform 的 src 统一转为字符串形式
 *
 * @param src - 图片源（字符串或 `ImageMetadata` 对象）
 * @returns 图片的字符串 URL
 */
function toSourceString(src: ImageTransform["src"]): string {
	return typeof src === "string" ? src : src.src;
}

/**
 * 判断是否为远程 HTTP(S) URL
 *
 * @param src - 图片源 URL
 * @returns 是否为远程 HTTP/HTTPS 地址
 */
function isRemoteHttpUrl(src: string): boolean {
	return /^https?:\/\//i.test(src);
}

/**
 * 将域名模式转换为正则并匹配主机名
 *
 * 支持 `*` 通配符，例如 `*.example.com` 匹配 `cdn.example.com`。
 *
 * @param hostname - 待匹配的主机名
 * @param pattern  - 域名匹配模式
 * @returns 是否匹配
 */
function matchDomain(hostname: string, pattern: string): boolean {
	const regex = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
	return new RegExp(`^${regex}$`).test(hostname);
}

/**
 * 从 Astro 图片配置中提取 ImageKit 服务配置
 *
 * @param imageConfig - Astro 图片配置对象
 * @returns ImageKit 服务配置，未配置时返回空对象
 */
function getServiceConfig(imageConfig: ImageConfig): ImageKitServiceConfig {
	return (imageConfig.service?.config as ImageKitServiceConfig) || {};
}

/**
 * 判断是否应对指定图片使用 ImageKit 处理
 *
 * 条件：服务已启用、图片为远程 HTTP URL、域名匹配配置的域名列表。
 *
 * @param src         - 图片源 URL
 * @param imageConfig - Astro 图片配置
 * @returns 是否应使用 ImageKit 处理
 */
function shouldUseImageKit(src: string, imageConfig: ImageConfig): boolean {
	const config = getServiceConfig(imageConfig);
	if (!config.enabled) return false;
	if (!isRemoteHttpUrl(src)) return false;

	try {
		const hostname = new URL(src).hostname;
		const domains = config.domains || [];
		if (domains.length === 0) return true;
		return domains.some((pattern) => matchDomain(hostname, pattern));
	} catch {
		return false;
	}
}

/**
 * 查找 URL 路径段中已有的 `tr:` 变换段索引
 *
 * @param segments - URL 路径段数组
 * @returns 变换段的索引，不存在时返回 `-1`
 */
function findTransformSegmentIndex(segments: string[]): number {
	return segments.findIndex((segment) => segment.startsWith("tr:"));
}

/**
 * 根据路径前缀解析 `tr:` 变换段的插入位置
 *
 * 在匹配到 `pathPrefix` 所有段之后的位置插入变换段。
 *
 * @param segments   - URL 路径段数组
 * @param pathPrefix - 路径前缀
 * @returns 应插入的索引位置
 */
function resolveInsertIndexByPrefix(
	segments: string[],
	pathPrefix?: string,
): number {
	if (!pathPrefix) return 0;
	const normalizedPrefix = sanitizeSegment(pathPrefix).replace(
		/^\/+|\/+$/g,
		"",
	);
	if (!normalizedPrefix) return 0;

	const prefixSegments = normalizedPrefix.split("/").filter(Boolean);
	if (prefixSegments.length === 0 || segments.length < prefixSegments.length) {
		return 0;
	}

	const matched = prefixSegments.every(
		(prefixSegment, index) => segments[index] === prefixSegment,
	);
	return matched ? prefixSegments.length : 0;
}

/**
 * 规范化图片质量参数
 *
 * 将各种格式的质量值统一为 1-100 的整数。
 *
 * @param rawQuality - 原始质量值（来自 ImageTransform）
 * @param fallback   - 回退默认值
 * @returns 规范化后的质量值 (1-100)
 */
function normalizeQuality(
	rawQuality: ImageTransform["quality"],
	fallback: number,
): number {
	const parsed =
		typeof rawQuality === "number"
			? rawQuality
			: Number.parseInt(String(rawQuality), 10);
	const effective = Number.isFinite(parsed) ? parsed : fallback;
	return Math.max(1, Math.min(100, Math.round(effective)));
}

/**
 * 规范化图片裁剪/填充模式
 *
 * @param rawFit   - 原始裁剪模式（来自 ImageTransform）
 * @param fallback - 回退默认模式
 * @returns 规范化后的模式字符串
 */
function normalizeFit(
	rawFit: ImageTransform["fit"],
	fallback?: ImageKitServiceConfig["fit"],
): string {
	const fit = rawFit || fallback || "at_max";
	return sanitizeSegment(String(fit));
}

/**
 * 规范化输出图片格式
 *
 * @param rawFormat  - 原始格式（来自 ImageTransform）
 * @param enableAvif - 是否允许 AVIF 输出
 * @returns 规范化后的格式，或 `undefined` 表示保持原格式
 */
function normalizeFormat(
	rawFormat: ImageTransform["format"],
	enableAvif: boolean,
): "avif" | "webp" | "jpeg" | undefined {
	if (!rawFormat) return undefined;
	const normalized = String(rawFormat).toLowerCase();
	if (normalized === "jpg") return "jpeg";
	if (normalized === "jpeg") return "jpeg";
	if (normalized === "webp") return "webp";
	if (normalized === "avif") return enableAvif ? "avif" : "webp";
	return undefined;
}

/**
 * 从图片 URL 推断其原始格式
 *
 * @param url - 图片 URL
 * @returns 推断出的图片格式
 */
function inferFormatFromUrl(
	url: string,
): "avif" | "webp" | "jpeg" | "png" | "gif" {
	try {
		const pathname = new URL(url).pathname.toLowerCase();
		if (pathname.endsWith(".avif")) return "avif";
		if (pathname.endsWith(".webp")) return "webp";
		if (pathname.endsWith(".png")) return "png";
		if (pathname.endsWith(".gif")) return "gif";
		if (pathname.endsWith(".jpeg") || pathname.endsWith(".jpg")) return "jpeg";
	} catch {
		// ignore parse failures and fallback to webp
	}
	return "webp";
}

/**
 * 构建 ImageKit 变换 URL
 *
 * 将原始图片 URL 转换为带 `tr:` 变换参数的 ImageKit URL。
 * 如果图片不需要 ImageKit 处理，则直接返回原始 URL。
 *
 * 变换参数构建优先级：
 * 1. `transformsByWidth` 中的自定义模板（按宽度匹配，或 `default` 键）
 * 2. 自动组合 `quality`、`fit`、`width`、`height`、`format`
 *
 * @param options     - Astro 图片变换选项
 * @param imageConfig - Astro 图片配置
 * @returns 处理后的图片 URL
 */
function buildImageKitUrl(
	options: ImageTransform,
	imageConfig: ImageConfig,
): string {
	const config = getServiceConfig(imageConfig);
	const originalSrc = toSourceString(options.src);
	if (!shouldUseImageKit(originalSrc, imageConfig)) return originalSrc;

	try {
		const parsed = new URL(originalSrc);
		const segments = parsed.pathname.split("/").filter(Boolean);
		const quality = normalizeQuality(options.quality, config.quality ?? 80);
		const fit = normalizeFit(options.fit, config.fit);
		const format = normalizeFormat(options.format, config.enableAvif === true);

		const width = options.width
			? Math.max(1, Math.round(options.width))
			: undefined;
		const height = options.height
			? Math.max(1, Math.round(options.height))
			: undefined;

		const transformsByWidth = config.transformsByWidth || {};
		const mappedTemplate =
			(width ? transformsByWidth[String(width)] : undefined) ||
			transformsByWidth.default;

		let transformValue = "";
		if (mappedTemplate && mappedTemplate.trim()) {
			const template = mappedTemplate.trim().replace(/^tr:/i, "");
			transformValue = template
				.replace(/\{width\}/g, width ? String(width) : "")
				.replace(/\{height\}/g, height ? String(height) : "")
				.replace(/\{quality\}/g, String(quality))
				.replace(/\{fit\}/g, fit)
				.replace(/\{format\}/g, format || "")
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean)
				.join(",");
		}

		if (!transformValue) {
			const transformParts = [`q-${quality}`, `c-${fit}`];
			if (width) transformParts.push(`w-${width}`);
			if (height) transformParts.push(`h-${height}`);
			if (format) transformParts.push(`f-${format}`);
			transformValue = transformParts.join(",");
		}

		const transformSegment = `tr:${transformValue}`;
		const transformIndex = findTransformSegmentIndex(segments);
		if (transformIndex >= 0) {
			segments[transformIndex] = transformSegment;
		} else {
			const insertIndex = resolveInsertIndexByPrefix(
				segments,
				config.pathPrefix,
			);
			segments.splice(insertIndex, 0, transformSegment);
		}

		parsed.pathname = `/${segments.join("/")}`;
		return parsed.toString();
	} catch {
		return originalSrc;
	}
}

/**
 * ImageKit 外部图片服务实例
 *
 * 实现 Astro 的 `ExternalImageService` 接口，代理 Sharp 服务的部分功能，
 * 同时对符合配置条件的远程图片使用 ImageKit CDN 进行变换处理。
 *
 * @example
 * ```ts
 * // astro.config.mjs
 * import { imageService } from "src/services/imagekit-image-service";
 *
 * export default defineConfig({
 *   image: {
 *     service: {
 *       entrypoint: "src/services/imagekit-image-service",
 *       config: {
 *         enabled: true,
 *         domains: ["ik.imagekit.io"],
 *         quality: 85,
 *       },
 *     },
 *   },
 * });
 * ```
 */
const imagekitExternalService: ExternalImageService<ImageKitServiceConfig> = {
	/**
	 * 验证并规范化图片变换选项
	 *
	 * 委托 Sharp 服务进行基础验证，然后应用 ImageKit 配置中的回退值。
	 *
	 * @param options     - 原始变换选项
	 * @param imageConfig - Astro 图片配置
	 * @returns 规范化后的变换选项
	 */
	async validateOptions(options, imageConfig) {
		const delegatedConfig = imageConfig as Parameters<
			NonNullable<typeof sharpService.validateOptions>
		>[1];
		const validated = sharpService.validateOptions
			? await sharpService.validateOptions({ ...options }, delegatedConfig)
			: options;

		const config = getServiceConfig(imageConfig);
		if (validated.quality == null && typeof config.quality === "number") {
			validated.quality = config.quality;
		}

		if (validated.format === "avif" && config.enableAvif !== true) {
			validated.format = "webp";
		}

		return validated;
	},

	/**
	 * 获取处理后的图片 URL
	 *
	 * 对符合 ImageKit 处理条件的图片返回带变换参数的 URL，否则返回原始 URL。
	 *
	 * @param options     - 图片变换选项
	 * @param imageConfig - Astro 图片配置
	 * @returns 最终图片 URL
	 */
	getURL(options, imageConfig) {
		return buildImageKitUrl(options, imageConfig);
	},

	/**
	 * 生成响应式图片的 `srcset` 属性值
	 *
	 * 仅对 ImageKit 处理的图片生成 srcset，其他情况返回空数组。
	 * 委托 Sharp 服务生成不同宽度的 URL 列表。
	 *
	 * @param options     - 图片变换选项
	 * @param imageConfig - Astro 图片配置
	 * @returns srcset 条目数组
	 */
	getSrcSet(options, imageConfig) {
		const src = toSourceString(options.src);
		if (!shouldUseImageKit(src, imageConfig)) {
			return [];
		}
		if (!sharpService.getSrcSet) {
			return [];
		}
		const delegatedConfig = imageConfig as Parameters<
			NonNullable<typeof sharpService.getSrcSet>
		>[1];
		return sharpService.getSrcSet(options, delegatedConfig);
	},

	/**
	 * 获取图片的 HTML 属性
	 *
	 * 委托 Sharp 服务生成 HTML 属性，若不可用则返回默认的 `loading="lazy"`
	 * 和 `decoding="async"`。
	 *
	 * @param options     - 图片变换选项
	 * @param imageConfig - Astro 图片配置
	 * @returns HTML 属性对象
	 */
	getHTMLAttributes(options, imageConfig) {
		if (sharpService.getHTMLAttributes) {
			const delegatedConfig = imageConfig as Parameters<
				NonNullable<typeof sharpService.getHTMLAttributes>
			>[1];
			return sharpService.getHTMLAttributes(options, delegatedConfig);
		}
		return {
			loading: options.loading ?? "lazy",
			decoding: options.decoding ?? "async",
		};
	},

	/**
	 * 获取远程图片的尺寸和格式信息
	 *
	 * 对于 ImageKit 处理的图片，根据 URL 后缀推断格式，并使用配置中的
	 * 默认宽高（或 1600×900）作为回退尺寸。其他图片委托 Sharp 服务处理。
	 *
	 * @param url         - 图片 URL
	 * @param imageConfig - Astro 图片配置
	 * @returns 图片尺寸与格式信息
	 * @throws 当 Sharp 服务不可用且非 ImageKit 图片时抛出错误
	 */
	getRemoteSize(url, imageConfig) {
		if (shouldUseImageKit(url, imageConfig)) {
			const config = getServiceConfig(imageConfig);
			return {
				width: Math.max(1, Math.round(config.defaultWidth ?? 1600)),
				height: Math.max(1, Math.round(config.defaultHeight ?? 900)),
				format: inferFormatFromUrl(url),
			};
		}

		if (sharpService.getRemoteSize) {
			const delegatedConfig = imageConfig as Parameters<
				NonNullable<typeof sharpService.getRemoteSize>
			>[1];
			return sharpService.getRemoteSize(url, delegatedConfig);
		}
		throw new Error("Remote size inference is unavailable");
	},
};

/** ImageKit 外部图片服务的默认导出，供 Astro 配置中的 `image.service.entrypoint` 引用 */
export default imagekitExternalService;
