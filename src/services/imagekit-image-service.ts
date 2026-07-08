import sharpService from "astro/assets/services/sharp";
import type { AstroConfig, ExternalImageService, ImageTransform } from "astro";

type ImageKitServiceConfig = {
	enabled?: boolean;
	domains?: string[];
	pathPrefix?: string;
	fit?: "at_max" | "maintain_ratio" | "pad_resize" | "force";
	quality?: number;
	enableAvif?: boolean;
	defaultWidth?: number;
	defaultHeight?: number;
	transformsByWidth?: Record<string, string>;
};

type ImageConfig = AstroConfig["image"];

function sanitizeSegment(value: string): string {
	return value.replace(/,/g, "").trim();
}

function toSourceString(src: ImageTransform["src"]): string {
	return typeof src === "string" ? src : src.src;
}

function isRemoteHttpUrl(src: string): boolean {
	return /^https?:\/\//i.test(src);
}

function matchDomain(hostname: string, pattern: string): boolean {
	const regex = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
	return new RegExp(`^${regex}$`).test(hostname);
}

function getServiceConfig(imageConfig: ImageConfig): ImageKitServiceConfig {
	return (imageConfig.service?.config as ImageKitServiceConfig) || {};
}

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

function findTransformSegmentIndex(segments: string[]): number {
	return segments.findIndex((segment) => segment.startsWith("tr:"));
}

function resolveInsertIndexByPrefix(segments: string[], pathPrefix?: string): number {
	if (!pathPrefix) return 0;
	const normalizedPrefix = sanitizeSegment(pathPrefix).replace(/^\/+|\/+$/g, "");
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

function normalizeQuality(rawQuality: ImageTransform["quality"], fallback: number): number {
	const parsed = typeof rawQuality === "number" ? rawQuality : Number.parseInt(String(rawQuality), 10);
	const effective = Number.isFinite(parsed) ? parsed : fallback;
	return Math.max(1, Math.min(100, Math.round(effective)));
}

function normalizeFit(rawFit: ImageTransform["fit"], fallback?: ImageKitServiceConfig["fit"]): string {
	const fit = rawFit || fallback || "at_max";
	return sanitizeSegment(String(fit));
}

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

function inferFormatFromUrl(url: string): "avif" | "webp" | "jpeg" | "png" | "gif" {
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

function buildImageKitUrl(options: ImageTransform, imageConfig: ImageConfig): string {
	const config = getServiceConfig(imageConfig);
	const originalSrc = toSourceString(options.src);
	if (!shouldUseImageKit(originalSrc, imageConfig)) return originalSrc;

	try {
		const parsed = new URL(originalSrc);
		const segments = parsed.pathname.split("/").filter(Boolean);
		const quality = normalizeQuality(options.quality, config.quality ?? 80);
		const fit = normalizeFit(options.fit, config.fit);
		const format = normalizeFormat(options.format, config.enableAvif === true);

		const width = options.width ? Math.max(1, Math.round(options.width)) : undefined;
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
			const insertIndex = resolveInsertIndexByPrefix(segments, config.pathPrefix);
			segments.splice(insertIndex, 0, transformSegment);
		}

		parsed.pathname = `/${segments.join("/")}`;
		return parsed.toString();
	} catch {
		return originalSrc;
	}
}

const imagekitExternalService: ExternalImageService<ImageKitServiceConfig> = {
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
	getURL(options, imageConfig) {
		return buildImageKitUrl(options, imageConfig);
	},
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

export default imagekitExternalService;
