import fs from "node:fs";
import path from "node:path";
import type { GalleryAlbum } from "@/types/config";
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

/**
 * 扫描相册目录中的所有图片文件
 */
export function scanAlbumPhotos(albumId: string): string[] {
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
	const localPhotos = files.map((f) => withBase(`/gallery/${albumId}/${f}`));

	// 读取 urls.txt 中的远程图片 URL
	const urlsFile = path.join(dir, "urls.txt");
	const remotePhotos: string[] = [];
	if (fs.existsSync(urlsFile)) {
		remotePhotos.push(
			...fs
				.readFileSync(urlsFile, "utf-8")
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line && !line.startsWith("#")),
		);
	}

	return [...localPhotos, ...remotePhotos];
}

/**
 * 获取相册封面图
 * 优先级：手动指定 > cover.* 文件 > 第一张图片
 */
export function getAlbumCover(album: GalleryAlbum, photos: string[]): string {
	if (album.cover) return withBase(album.cover);
	const coverFile = photos.find((p) => /\/cover\./i.test(p));
	return coverFile || photos[0] || "";
}

/** 排序后的相册（含封面和照片数量） */
export type SortedAlbum = GalleryAlbum & { cover: string; photoCount: number };

/**
 * 获取排序后的相册列表（含封面和照片数量）
 * 按日期降序排列，最新的相册在前
 */
export function getSortedAlbums(albums: GalleryAlbum[]): SortedAlbum[] {
	const parseAlbumTime = (date?: string) => {
		if (!date) return 0;
		const timestamp = Date.parse(date);
		return Number.isNaN(timestamp) ? 0 : timestamp;
	};

	return [...albums]
		.sort((a, b) => parseAlbumTime(b.date) - parseAlbumTime(a.date))
		.map((album) => {
			const photos = scanAlbumPhotos(album.id);
			const cover = getAlbumCover(album, photos);
			return { ...album, cover, photoCount: photos.length };
		});
}
