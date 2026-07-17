/**
 * OpenGraph 图片生成通用模块
 *
 * 提供所有页面类型共用的 OG 图片渲染能力（satori + sharp），
 * 以及配置辅助函数（是否启用、图片路径、元数据覆盖解析）。
 *
 * 设计要点：
 * - 所有页面共用同一套 satori 模板，仅通过 title/description/footerRight 参数化，保证视觉一致。
 * - 仅生成 siteConfig.lang 对应语言的 OG 图片，不为每种语言分别生成。
 */
import * as fs from "node:fs";
import satori from "satori";
import { profileConfig, siteConfig } from "@/config";

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

type FontStyle = "normal" | "italic";

interface FontOptions {
	data: Buffer | ArrayBuffer;
	name: string;
	weight?: Weight;
	style?: FontStyle;
	lang?: string;
}

/** 受支持的 OG 页面类型（与 GenerateOgImagesConfig 的子键对应，排除总开关 enable） */
export type OgPageKey =
	| "index"
	| "posts"
	| "about"
	| "guestbook"
	| "friends"
	| "gallery"
	| "galleryAlbum";

/* -------------------------------------------------------------------------- */
/* 配置辅助                                                                    */
/* -------------------------------------------------------------------------- */

/** 判断某页面类型的 OG 图片是否启用（总开关 && 子开关） */
export function isOgEnabled(pageKey: OgPageKey): boolean {
	const cfg = siteConfig.generateOgImages;
	return !!cfg?.enable && !!cfg[pageKey]?.enable;
}

/**
 * 构建某页面类型的 OG 图片相对路径（如 `/og/posts/hello.png`）。
 * 未启用或缺少必要 slug 时返回 undefined。
 */
export function getOgImagePath(
	pageKey: OgPageKey,
	slug?: string,
): string | undefined {
	if (!isOgEnabled(pageKey)) return undefined;
	switch (pageKey) {
		case "index":
			return "/og/index.png";
		case "about":
			return "/og/about.png";
		case "guestbook":
			return "/og/guestbook.png";
		case "friends":
			return "/og/friends.png";
		case "gallery":
			return "/og/gallery.png";
		case "posts":
			return slug ? `/og/posts/${slug}.png` : undefined;
		case "galleryAlbum":
			return slug ? `/og/gallery/${slug}.png` : undefined;
	}
}

/**
 * 解析某页面类型最终的 OG 元数据：meta 覆盖页面默认值（meta ?? default）。
 */
export function resolveOgMeta(
	pageKey: OgPageKey,
	defaults: { title: string; description?: string },
): { title: string; description?: string } {
	const meta = siteConfig.generateOgImages?.[pageKey]?.meta;
	return {
		title: meta?.title ?? defaults.title,
		description: meta?.description ?? defaults.description,
	};
}

/* -------------------------------------------------------------------------- */
/* 字体加载（Google Fonts, 模块级缓存）                                         */
/* -------------------------------------------------------------------------- */

let fontCache: { regular: Buffer | null; bold: Buffer | null } | null = null;

async function fetchNotoSansSCFonts(): Promise<{
	regular: Buffer | null;
	bold: Buffer | null;
}> {
	if (fontCache) return fontCache;
	try {
		const cssResp = await fetch(
			"https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap",
		);
		if (!cssResp.ok) throw new Error("Failed to fetch Google Fonts CSS");
		const cssText = await cssResp.text();

		const getUrlForWeight = (weight: number) => {
			const blockRe = new RegExp(
				`@font-face\\s*{[^}]*font-weight:\\s*${weight}[^}]*}`,
				"g",
			);
			const match = cssText.match(blockRe);
			if (!match || match.length === 0) return null;
			const urlMatch = match[0].match(/url\((https:[^)]+)\)/);
			return urlMatch ? urlMatch[1] : null;
		};

		const regularUrl = getUrlForWeight(400);
		const boldUrl = getUrlForWeight(700);

		if (!regularUrl || !boldUrl) {
			console.warn(
				"Could not find font urls in Google Fonts CSS; falling back to no fonts.",
			);
			fontCache = { regular: null, bold: null };
			return { regular: null, bold: null };
		}

		const [rResp, bResp] = await Promise.all([
			fetch(regularUrl),
			fetch(boldUrl),
		]);
		if (!rResp.ok || !bResp.ok) {
			console.warn(
				"Failed to download font files from Google; falling back to no fonts.",
			);
			fontCache = { regular: null, bold: null };
			return { regular: null, bold: null };
		}

		const rBuf = Buffer.from(await rResp.arrayBuffer());
		const bBuf = Buffer.from(await bResp.arrayBuffer());
		fontCache = { regular: rBuf, bold: bBuf };
		return fontCache;
	} catch (err) {
		console.warn("Error fetching fonts:", err);
		fontCache = { regular: null, bold: null };
		return { regular: null, bold: null };
	}
}

// 缓存 sharp 模块，避免在每次 GET 调用中重复动态导入
let sharpPromise: Promise<typeof import("sharp")["default"]> | null = null;
function getSharp() {
	if (!sharpPromise) {
		sharpPromise = import("sharp").then((m) => m.default);
	}
	return sharpPromise;
}

/**
 * 获取 1×1 透明 PNG 的 base64 Data URL（兜底图片）。
 *
 * 当图片处理失败（如格式不被 sharp 支持）时，使用此透明占位图替代。
 * 通过 sharp 的 `create` API 生成，懒加载且仅生成一次，结果被缓存。
 *
 * @returns `data:image/png;base64,...` 格式的透明 PNG Data URL
 */
let transparentPngPromise: Promise<string> | null = null;
function getTransparentPngBase64(): Promise<string> {
	if (!transparentPngPromise) {
		transparentPngPromise = getSharp().then((sharp) =>
			sharp({
				create: {
					width: 1,
					height: 1,
					channels: 4,
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				},
			})
				.png()
				.toBuffer()
				.then((buf) => `data:image/png;base64,${buf.toString("base64")}`),
		);
	}
	return transparentPngPromise;
}

// 已转换图片的缓存（按源路径），避免对同一文件（如头像、站点图标）重复进行 sharp 处理
const convertedImageCache = new Map<string, string>();

/**
 * 将图片 Buffer 转换为 PNG base64 Data URL，并缓存结果。
 *
 * 以源文件路径作为缓存键，避免对同一图片文件（如头像、站点图标）
 * 在多次 OG 图片生成中重复进行 sharp 处理。
 * 若 sharp 无法处理该图片格式，会输出警告并使用透明占位图代替。
 *
 * @param imageBuffer - 图片文件的原始 Buffer
 * @param sourcePath - 图片文件的磁盘路径，用作缓存键
 * @returns `data:image/png;base64,...` 格式的 PNG Data URL；处理失败时返回透明图
 */
async function imageToPngBase64(
	imageBuffer: Buffer,
	sourcePath: string,
): Promise<string> {
	const cached = convertedImageCache.get(sourcePath);
	if (cached) return cached;

	const sharp = await getSharp();
	try {
		const pngBuffer = await sharp(imageBuffer).png().toBuffer();
		const result = `data:image/png;base64,${pngBuffer.toString("base64")}`;
		convertedImageCache.set(sourcePath, result);
		return result;
	} catch (err) {
		console.warn(
			"\n \x1b[33m[OG Image] Warning \n" +
				`  无法处理图片 "${sourcePath}"，可能是不被 sharp 支持的图片格式。\n` +
				"  已使用透明图片替代，请将图片转换为 sharp 支持的格式（PNG/JPEG/WebP/AVIF/TIFF/SVG）。\n" +
				`  Failed to process image "${sourcePath}", possibly an unsupported image format for sharp.\n` +
				"  A transparent image was used instead. Please convert it to a sharp-supported format.\n" +
				`  Error: ${err instanceof Error ? err.message : String(err)}\x1b[0m`,
		);
		return getTransparentPngBase64();
	}
}

/* -------------------------------------------------------------------------- */
/* 头像 / 图标加载（从磁盘读取，小文件）                                        */
/* -------------------------------------------------------------------------- */

async function loadAvatarBase64(): Promise<string> {
	let avatarBase64: string;

	if (profileConfig.avatar?.startsWith("http")) {
		avatarBase64 = profileConfig.avatar;
	} else {
		const avatarPath = profileConfig.avatar?.startsWith("/")
			? `./public${profileConfig.avatar}`
			: `./src/${profileConfig.avatar}`;
		avatarBase64 = await imageToPngBase64(
			fs.readFileSync(avatarPath),
			avatarPath,
		);
	}
	return avatarBase64;
}

async function loadIconBase64(): Promise<string> {
	// 站点图标处理：优先选择 png 格式的图标，回退到第一个 favicon
	let iconPath = "./public/favicon/favicon-dark-192.png";
	if (siteConfig.favicon.length > 0) {
		const pngFavicon = siteConfig.favicon.find((f) =>
			f.src.toLowerCase().endsWith(".png"),
		);
		iconPath = `./public${(pngFavicon ?? siteConfig.favicon[0]).src}`;
	}
	const iconBase64 = await imageToPngBase64(
		fs.readFileSync(iconPath),
		iconPath,
	);
	return iconBase64;
}

/* -------------------------------------------------------------------------- */
/* 统一 OG 图片渲染                                                            */
/* -------------------------------------------------------------------------- */

export interface OgRenderOptions {
	/** 主标题（必填） */
	title: string;
	/** 副标题/描述（可选，显示在主标题下方） */
	description?: string;
	/** 页脚右侧文本（可选，如发布日期、相册日期/地点、站点副标题） */
	footerRight?: string;
}

/**
 * 渲染 OG 图片（1200x630 PNG）。所有页面类型共用此实现。
 * 返回 PNG 字节数组，供端点直接作为 Response body 返回。
 */
export async function renderOgImage(
	opts: OgRenderOptions,
): Promise<Uint8Array<ArrayBuffer>> {
	const { title, description, footerRight } = opts;

	const { regular: fontRegular, bold: fontBold } = await fetchNotoSansSCFonts();
	const avatarBase64 = await loadAvatarBase64();
	const iconBase64 = await loadIconBase64();

	const hue = siteConfig.themeColor.hue;
	const primaryColor = `hsl(${hue}, 90%, 65%)`;
	const textColor = "hsl(0, 0%, 95%)";
	const subtleTextColor = `hsl(${hue}, 10%, 75%)`;
	const backgroundColor = `hsl(${hue}, 15%, 12%)`;

	const template = {
		type: "div",
		props: {
			style: {
				height: "100%",
				width: "100%",
				display: "flex",
				flexDirection: "column",
				backgroundColor: backgroundColor,
				fontFamily:
					'"Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
				padding: "60px",
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							width: "100%",
							display: "flex",
							alignItems: "center",
							gap: "20px",
						},
						children: [
							{
								type: "img",
								props: {
									src: iconBase64,
									width: 48,
									height: 48,
									style: { borderRadius: "10px" },
								},
							},
							{
								type: "div",
								props: {
									style: {
										fontSize: "36px",
										fontWeight: 600,
										color: subtleTextColor,
									},
									children: siteConfig.title,
								},
							},
						],
					},
				},
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							flexDirection: "column",
							justifyContent: "center",
							flexGrow: 1,
							gap: "20px",
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										display: "flex",
										alignItems: "flex-start",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													width: "10px",
													height: "68px",
													backgroundColor: primaryColor,
													borderRadius: "6px",
													marginTop: "14px",
												},
											},
										},
										{
											type: "div",
											props: {
												style: {
													fontSize: "72px",
													fontWeight: 700,
													lineHeight: 1.2,
													color: textColor,
													marginLeft: "25px",
													display: "-webkit-box",
													overflow: "hidden",
													textOverflow: "ellipsis",
													lineClamp: 3,
													WebkitLineClamp: 3,
													WebkitBoxOrient: "vertical",
												},
												children: title,
											},
										},
									],
								},
							},
							description && {
								type: "div",
								props: {
									style: {
										fontSize: "32px",
										lineHeight: 1.5,
										color: subtleTextColor,
										paddingLeft: "35px",
										display: "-webkit-box",
										overflow: "hidden",
										textOverflow: "ellipsis",
										lineClamp: 2,
										WebkitLineClamp: 2,
										WebkitBoxOrient: "vertical",
									},
									children: description,
								},
							},
						],
					},
				},
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							width: "100%",
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										display: "flex",
										alignItems: "center",
										gap: "20px",
									},
									children: [
										{
											type: "img",
											props: {
												src: avatarBase64,
												width: 60,
												height: 60,
												style: { borderRadius: "50%" },
											},
										},
										{
											type: "div",
											props: {
												style: {
													fontSize: "28px",
													fontWeight: 600,
													color: textColor,
												},
												children: profileConfig.name,
											},
										},
									],
								},
							},
							footerRight && {
								type: "div",
								props: {
									style: { fontSize: "28px", color: subtleTextColor },
									children: footerRight,
								},
							},
						],
					},
				},
			],
		},
	};

	const fonts: FontOptions[] = [];
	if (fontRegular) {
		fonts.push({
			name: "Noto Sans SC",
			data: fontRegular,
			weight: 400,
			style: "normal",
		});
	}
	if (fontBold) {
		fonts.push({
			name: "Noto Sans SC",
			data: fontBold,
			weight: 700,
			style: "normal",
		});
	}

	const svg = await satori(template, {
		width: 1200,
		height: 630,
		fonts,
	});

	const sharp = await getSharp();
	const png = await sharp(Buffer.from(svg)).png().toBuffer();

	// sharp 返回 Node Buffer（底层为 ArrayBuffer）；显式构造 ArrayBuffer 视图
	// 以兼容 TS6 收紧后的 BodyInit/BufferSource 类型要求
	return new Uint8Array(
		png.buffer as ArrayBuffer,
		png.byteOffset,
		png.byteLength,
	);
}

/* -------------------------------------------------------------------------- */
/* 端点通用响应头                                                              */
/* -------------------------------------------------------------------------- */

export const ogImageResponseHeaders = {
	"Content-Type": "image/png",
	"Cache-Control": "public, max-age=31536000, immutable",
};
