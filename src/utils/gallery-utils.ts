import fs from "node:fs";
import path from "node:path";
import type { GalleryAlbum } from "@/types/config";
import type { GalleryThumbnailConfig } from "@/types/galleryConfig";
import { url } from "@/utils/url-utils";

function withBase(assetPath: string): string {
	if (!assetPath) return "";
	if (/^(https?:)?\/\//i.test(assetPath) || /^(data|blob):/i.test(assetPath)) {
		return assetPath;
	}
	const normalizedPath = assetPath.startsWith("/")
		? assetPath
		: `/${assetPath}`;
	const base = import.meta.env.BASE_URL || "/";
	if (base !== "/" && normalizedPath.startsWith(base)) {
		return normalizedPath;
	}
	return url(normalizedPath);
}

type PhotoInfo = {
	src: string;
	type: "local" | "remote";
};

/**
 * 扫描相册目录中的所有图片文件
 */
export function scanAlbumPhotos(albumId: string): PhotoInfo[] {
	const dir = path.join(process.cwd(), "public", "gallery", albumId);
	if (!fs.existsSync(dir)) return [];
	const files = fs
		.readdirSync(dir)
		.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
		.sort();
	// 将 cover.* 排到第一位
	const coverIdx = files.findIndex((f) => /^cover\./i.test(f));
	if (coverIdx > 0) {
		const [coverFile] = files.splice(coverIdx, 1);
		files.unshift(coverFile);
	}
	const localPhotos = files.map(
		(f) =>
			({
				src: withBase(`/gallery/${albumId}/${f}`),
				type: "local",
			}) as PhotoInfo,
	);

	// 读取 urls.txt 中的远程图片 URL
	const urlsFile = path.join(dir, "urls.txt");
	let remotePhotos: PhotoInfo[] = [];
	if (fs.existsSync(urlsFile)) {
		remotePhotos = fs
			.readFileSync(urlsFile, "utf-8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.map((url) => ({ src: url, type: "remote" }) as PhotoInfo);
	}

	return [...localPhotos, ...remotePhotos];
}

/**
 * 获取相册封面图
 * 优先级：手动指定 > cover.* 文件 > 第一张图片
 */
export function getAlbumCover(album: GalleryAlbum, photos: string[]): string;
export function getAlbumCover(album: GalleryAlbum, photos: PhotoInfo[]): string;
export function getAlbumCover(
	album: GalleryAlbum,
	photos: string[] | PhotoInfo[],
): string {
	if (album.cover) return withBase(album.cover);
	const photoUrls = (photos as Array<string | PhotoInfo>).map((p) =>
		typeof p === "string" ? p : p.src,
	);
	const coverFile = photoUrls.find((p) => /\/cover\./i.test(p));
	return coverFile || photoUrls[0] || "";
}

/**
 * 构建相册缩略图 URL
 * - 未配置/关闭/规则为空：返回原图 URL
 * - 模板解析后为空：回退原图 URL
 * - 本地图片返回原始 URL，远程图片根据规则生成缩略图 URL
 * @param photos 相册图片列表
 * @param thumbnailConfig 相册缩略图配置
 * @returns {src: string, thumbSrc: string | null} 返回原图 URL 和缩略图 URL
 */
export function buildPhotoThumbnailSrc(
	photos: PhotoInfo[],
	thumbnailConfig?: GalleryThumbnailConfig,
): { src: string; thumbSrc: string | null }[] {
	return photos.map((photo) => {
		const src = photo.src;
		let thumbSrc: string | null = null;
		if (photo.type === "remote" && thumbnailConfig?.enabled) {
			const rule = thumbnailConfig.rule?.trim();
			if (rule) {
				const convertedSrc = applyThumbnailRule(
					rule,
					parseThumbnailTokens(src),
				).trim();
				thumbSrc = convertedSrc || null;
			}
		}
		return { src, thumbSrc };
	});
}

type ThumbnailTokens = {
	url: string;
	fullBase: string;
	base: string;
	query: string;
	hash: string;
	origin: string;
	pathname: string;
	dir: string;
	fileName: string;
	basename: string;
	ext: string;
};

/**
 * 解析缩略图模板可用的 URL token。
 *
 * 处理顺序：先拆分 hash（#...），再拆分 query（?...），最后解析目录、文件名和扩展名。
 * 当传入 http/https 绝对地址时，会额外解析出 origin 与 pathname；
 * 非绝对地址（如站内相对路径）会保留回退值，不抛异常。
 *
 * 可用 token 示例：
 * - ${url}: 原始完整 URL
 * - ${fullBase}: 去除 query/hash 后的 URL
 * - ${base}: 去除扩展名后的路径
 * - ${query}: 查询字符串（包含 ?）
 * - ${hash}: 锚点（包含 #）
 * - ${origin}: 绝对 URL 的协议+域名
 * - ${pathname}: 绝对 URL 的路径部分
 * - ${dir}: 文件所在目录（含末尾 /）
 * - ${fileName}: 文件名（含扩展名）
 * - ${basename}: 文件名（不含扩展名）
 * - ${ext}: 扩展名（不含 .）
 *
 * @param originalSrc 原始图片 URL。
 * @returns 模板替换所需的 token 对象。
 */
function parseThumbnailTokens(originalSrc: string): ThumbnailTokens {
	let hash = "";
	let query = "";
	let fullBase = originalSrc;

	const hashIndex = fullBase.indexOf("#");
	if (hashIndex >= 0) {
		hash = fullBase.slice(hashIndex);
		fullBase = fullBase.slice(0, hashIndex);
	}

	const queryIndex = fullBase.indexOf("?");
	if (queryIndex >= 0) {
		query = fullBase.slice(queryIndex);
		fullBase = fullBase.slice(0, queryIndex);
	}

	const lastSlash = fullBase.lastIndexOf("/");
	const fileName = lastSlash >= 0 ? fullBase.slice(lastSlash + 1) : fullBase;
	const dir = lastSlash >= 0 ? fullBase.slice(0, lastSlash + 1) : "";
	const dotIndex = fileName.lastIndexOf(".");
	const basename = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
	const ext = dotIndex > 0 ? fileName.slice(dotIndex + 1) : "";
	const base = dotIndex > 0 ? `${dir}${basename}` : fullBase;

	let origin = "";
	let pathname = fullBase;
	if (/^https?:\/\//i.test(fullBase)) {
		try {
			const parsed = new URL(fullBase);
			origin = parsed.origin;
			pathname = parsed.pathname;
		} catch {
			// ignore invalid absolute URL and keep fallback values
		}
	}

	return {
		url: originalSrc,
		fullBase,
		base,
		query,
		hash,
		origin,
		pathname,
		dir,
		fileName,
		basename,
		ext,
	};
}

/**
 * 按模板规则替换缩略图 URL。
 *
 * 规则中的 `${token}` 会按 {@link ThumbnailTokens} 中同名字段替换。
 * 未定义 token 会原样保留，便于排查配置问题。
 *
 * @param rule 缩略图模板规则，例如 `${base}_thumb.${ext}`。
 * @param tokens 由 {@link parseThumbnailTokens} 解析得到的 token。
 * @returns 替换后的 URL 字符串。
 */
function applyThumbnailRule(rule: string, tokens: ThumbnailTokens): string {
	return rule.replace(
		/\$\{([a-zA-Z][\w]*)\}/g,
		(match, tokenName: keyof ThumbnailTokens) => {
			if (tokenName in tokens) {
				return tokens[tokenName];
			}
			return match;
		},
	);
}
