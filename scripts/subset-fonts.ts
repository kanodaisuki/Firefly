// 字体子集化构建后脚本
// 在 astro build 之后运行，扫描 dist/ 中所有 HTML 页面，收集实际使用的字符，
// 为标记了 subset: true 的本地字体生成轻量 woff2 子集文件。

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { glob } from "glob";
import subsetFont from "subset-font";
import { fontConfig, fontsList } from "../src/config";
import { collectUsedFontCssVars, toPublicPath } from "../src/utils/fontHelper";

const require = createRequire(import.meta.url);

// ─── 配置 ───────────────────────────────────────────────

const DIST_DIR = "dist";
const OUTPUT_DIR = "dist/_astro/fonts";

// ─── 字体配置解析 ────────────────────────────────────────

type LocalSubsetFont = {
	id: string;
	family: string;
	src: string;
	weight?: string | number;
	style?: string;
	display?: string;
	subsetExtraChars?: string;
	/** 可变字体变量轴控制，透传给 subset-font 的 variationAxes 选项 */
	subsetVariationAxes?: Record<
		string,
		number | { min: number; max: number; default?: number }
	>;
};

/**
 * 从 fontConfig.subsetFonts 获取需要子集化的本地字体，
 * 交叉引用 fonts 数组获取字体文件路径。
 * 仅处理实际被使用的字体（在 selected、bannerTitleFont 等区域字段中引用的）。
 */
function getLocalSubsetFonts(): LocalSubsetFont[] {
	if (!fontConfig.enable || !fontConfig.subsetFonts) return [];

	const subsetEntries = Object.entries(fontConfig.subsetFonts);
	if (subsetEntries.length === 0) return [];

	// 构建实际使用的字体 CSS 变量集合（与 astro.config.mjs 共享同一逻辑）
	const used = collectUsedFontCssVars(fontConfig);

	// 建立 cssVariable → fontsList 条目的映射
	const fontByCssVar = new Map<string, (typeof fontsList)[number]>();
	for (const f of fontsList) {
		if (f.cssVariable) fontByCssVar.set(f.cssVariable, f);
	}

	const result: LocalSubsetFont[] = [];
	for (const [cssVar, opts] of subsetEntries) {
		// 跳过未被使用的字体，避免生成无用的子集文件
		if (!used.has(cssVar)) {
			console.log(
				`   ⏭ Skipping '${cssVar}' — not referenced in selected or any font region.`,
			);
			continue;
		}

		const f = fontByCssVar.get(cssVar);
		if (!f?.options?.variants) continue;

		for (const v of f.options.variants) {
			if (!v.src?.length) continue;
			const rawSrc = v.src[0];
			// 将本地路径（如 "./public/assets/fonts/MyFont.woff2"）转换为访问路径
			const publicPath = toPublicPath(rawSrc);
			if (publicPath === null) {
				console.warn(
					`   ⚠ Skipping variant with unexpected src path: "${rawSrc}".\n` +
						`     Expected a path under public/ (e.g. "./public/assets/fonts/MyFont.woff2") or an absolute path (e.g. "/assets/fonts/MyFont.woff2").`,
				);
				continue;
			}
			result.push({
				id: `${f.name}-${v.weight || "default"}`
					.toLowerCase()
					.replace(/\s+/g, "-"),
				family: f.name,
				src: publicPath,
				weight: v.weight,
				style: v.style,
				subsetExtraChars: opts.extraChars,
				subsetVariationAxes: opts.variationAxes,
			});
		}
	}
	return result;
}

// ─── 字符收集 ────────────────────────────────────────────

/**
 * 从 HTML 字符串中提取纯文本内容（比 JSDOM 轻量得多）
 */
function extractTextFromHtml(html: string): string {
	// 移除 script 和 style 标签及其内容
	let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
	// 移除所有 HTML 标签
	text = text.replace(/<[^>]+>/g, " ");
	// 解码常见 HTML 实体
	text = text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
	// 提取 alt、title、aria-label、placeholder 属性值
	const attrMatches = html.matchAll(
		/(?:alt|title|aria-label|placeholder)=["']([^"']+)["']/gi,
	);
	for (const match of attrMatches) {
		text += match[1];
	}
	return text;
}

/**
 * 扫描 dist/ 中所有 HTML 文件，提取页面中实际使用的所有字符
 */
async function collectChars(): Promise<string> {
	const htmlFiles = await glob(`${DIST_DIR}/**/*.html`);
	const charSet = new Set<string>();

	for (const file of htmlFiles) {
		const html = await fs.readFile(file, "utf-8");
		const text = extractTextFromHtml(html);
		for (const c of text) charSet.add(c);
	}

	return [...charSet].join("");
}

// ─── 子集生成 ────────────────────────────────────────────

function contentHash(buffer: Buffer): string {
	return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function fullHash(buffer: Buffer): string {
	return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * 将本地 src 路径解析为 public/ 下的绝对文件路径
 */
function resolveFontPath(src: string): string {
	const relativePath = src.startsWith("/") ? src.slice(1) : src;
	return path.resolve("public", relativePath);
}

/**
 * 检测字体文件的实际格式
 */
function detectFontFormat(
	filePath: string,
): "woff2" | "woff" | "truetype" | "opentype" {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case ".woff2":
			return "woff2";
		case ".woff":
			return "woff";
		case ".otf":
			return "opentype";
		case ".ttf":
		default:
			return "truetype";
	}
}

// ─── SFNT 表解析（用于可变字体校验） ─────────────────────

/**
 * 解析 SFNT (TrueType/OpenType) 字体文件的表目录。
 *
 * 注意：WOFF2 容器需先解包为 SFNT 才能用此函数；本脚本中只对原始本地字体
 * （TTF/OTF）和 subset-font 输出的 woff2 调用。对 woff2 输出，subset-font
 * 内部经 fontverter 转换，本函数不直接处理 woff2 容器——校验时只对原始
 * 字体缓冲调用即可判断"原始是否可变"。
 *
 * @returns 表名 → { offset, length } 的映射
 */
function parseSfntTables(
	buffer: Buffer,
): Map<string, { offset: number; length: number }> {
	const tables = new Map<string, { offset: number; length: number }>();
	// SFNT offset table: sfntVersion(4) + numTables(2) + searchRange(2) + entrySelector(2) + rangeShift(2)
	if (buffer.length < 12) return tables;
	const numTables = buffer.readUInt16BE(4);
	// 每个表记录 16 字节: tag(4) + checksum(4) + offset(4) + length(4)
	const tableDirOffset = 12;
	for (let i = 0; i < numTables; i++) {
		const recOffset = tableDirOffset + i * 16;
		if (recOffset + 16 > buffer.length) break;
		const tag = buffer.toString("ascii", recOffset, recOffset + 4);
		const offset = buffer.readUInt32BE(recOffset + 8);
		const length = buffer.readUInt32BE(recOffset + 12);
		tables.set(tag, { offset, length });
	}
	return tables;
}

/**
 * 判断字体缓冲是否为可变字体（含 `fvar` 表）。
 * 仅对 SFNT (TTF/OTF) 格式有效；woff2 需先解包，这里不处理。
 */
function isVariableFont(buffer: Buffer): boolean {
	return parseSfntTables(buffer).has("fvar");
}

/**
 * 读取可变字体 `fvar` 表中 `wght` 轴的范围。
 *
 * fvar 表结构：
 *   majorVersion(2) + minorVersion(2) + axesArrayOffset(2) + reserved(2)
 *   + axisCount(2) + axisSize(2) + [...axisCount 个轴记录]
 * 每个轴记录 20 字节:
 *   tag(4) + minValue(4, Fixed 16.16) + defaultValue(4) + maxValue(4)
 *   + flags(2) + axisNameID(2)
 *
 * Fixed 为 16.16 定点数，需除以 65536。
 *
 * @returns wght 轴的 { min, max, default }，若不存在 fvar 或 wght 轴则返回 null
 */
function readWghtAxisRange(
	buffer: Buffer,
): { min: number; max: number; default: number } | null {
	const tables = parseSfntTables(buffer);
	const fvar = tables.get("fvar");
	if (!fvar) return null;
	const base = fvar.offset;
	if (base + 8 > buffer.length) return null;
	const axisCount = buffer.readUInt16BE(base + 8);
	// axesArrayOffset 是相对 fvar 表起始的偏移（通常为 16）
	const axesArrayOffset = buffer.readUInt16BE(base + 4);
	const axisSize = buffer.readUInt16BE(base + 10) || 20;
	const FIXED = 65536;
	for (let i = 0; i < axisCount; i++) {
		const axisOffset = base + axesArrayOffset + i * axisSize;
		if (axisOffset + 20 > buffer.length) break;
		const tag = buffer.toString("ascii", axisOffset, axisOffset + 4);
		if (tag === "wght") {
			const min = buffer.readInt32BE(axisOffset + 4) / FIXED;
			const def = buffer.readInt32BE(axisOffset + 8) / FIXED;
			const max = buffer.readInt32BE(axisOffset + 12) / FIXED;
			return { min, max, default: def };
		}
	}
	return null;
}

/**
 * 解码 woff2 缓冲为 SFNT 缓冲，用于校验子集化产物是否保留可变性。
 *
 * subset-font 输出的 woff2 是压缩容器，需先解包才能读取表目录。
 * 复用 subset-font 的传递依赖 fontverter（pnpm 下需从 subset-font 位置解析）。
 */
async function woff2ToSfnt(buffer: Buffer): Promise<Buffer> {
	const fontverterPath = require.resolve("fontverter", {
		paths: [require.resolve("subset-font")],
	});
	// Windows 绝对路径需转为 file:// URL 才能作为 ESM import 说明符
	const { convert } = (await import(pathToFileURL(fontverterPath).href)) as {
		convert: (buf: Buffer, to: string) => Promise<Buffer>;
	};
	return convert(buffer, "sfnt");
}

// ─── 主流程 ──────────────────────────────────────────────

interface SubsetResult {
	id: string;
	family: string;
	weight?: string | number;
	style?: string;
	display?: string;
	hash: string;
	format: string;
	originalSrc: string;
	originalHash: string;
	originalSize: number;
	/**
	 * 子集化时传入的 variationAxes（仅可变字体非空）。
	 * 用于 CSS font-weight patch 阶段判断是否需要改写声明。
	 */
	variationAxes?: Record<
		string,
		number | { min: number; max: number; default?: number }
	>;
	/**
	 * 根据 variationAxes.wght 计算出的、应写入 CSS `@font-face` 的 `font-weight` 值。
	 * - wght pin 为单值 number → `"400"`
	 * - wght 缩小为 {min,max} → `"300 700"`
	 * - 无 variationAxes.wght → undefined（不改写 CSS）
	 */
	newWeightCss?: string;
}

async function main() {
	console.log("🔤 Font subsetting started...");

	// 1. 从配置中获取需要子集化的本地字体
	const localSubsetFonts = getLocalSubsetFonts();

	if (localSubsetFonts.length === 0) {
		console.log("   No local fonts with subset: true found. Skipping.");
		return;
	}

	console.log(
		`   Found ${localSubsetFonts.length} font(s) to subset: ${localSubsetFonts.map((f) => f.id).join(", ")}`,
	);

	// 2. 收集页面字符
	console.log("🔍 Collecting characters from dist/...");
	const pageChars = await collectChars();
	console.log(`   Collected ${pageChars.length} unique characters.`);

	if (pageChars.length === 0) {
		console.warn("⚠ No characters found in dist/. Skipping subsetting.");
		return;
	}

	// 3. 确保输出目录存在
	await fs.mkdir(OUTPUT_DIR, { recursive: true });

	// 4. 为每个字体生成子集
	const results: SubsetResult[] = [];

	for (const font of localSubsetFonts) {
		const fontPath = resolveFontPath(font.src);

		// 检查字体文件是否存在
		try {
			await fs.access(fontPath);
		} catch {
			console.error(`❌ Font file not found: ${fontPath} (src: ${font.src})`);
			continue;
		}

		// 合并页面字符和额外字符
		let chars = pageChars;
		if (font.subsetExtraChars) {
			const extraSet = new Set<string>([
				...pageChars,
				...font.subsetExtraChars,
			]);
			chars = [...extraSet].join("");
		}

		console.log(`⏳ Generating subset for '${font.id}' (${font.family})...`);

		const fontBuffer = await fs.readFile(fontPath);
		const originalFormat = detectFontFormat(fontPath);
		const originalIsVariable = isVariableFont(fontBuffer);
		const variationAxes = font.subsetVariationAxes;

		// 预检：若配了 variationAxes 但原字体并非可变字体，subset-font 会抛晦涩错误
		if (variationAxes && !originalIsVariable) {
			console.warn(
				`   ⚠ '${font.id}' 配置了 variationAxes，但原字体不含 fvar 表（非可变字体），将忽略 variationAxes 配置。`,
			);
		}

		try {
			const subsetBuffer = await subsetFont(fontBuffer, chars, {
				targetFormat: "woff2",
				preserveNameTable: true,
				// 仅在原字体确实可变时传入 variationAxes，避免对静态字体产生干扰
				...(variationAxes && originalIsVariable ? { variationAxes } : {}),
			});

			// 可变性校验：原字体可变时，确认子集产物是否仍保留 fvar
			let subsetIsVariable = false;
			let subsetWghtRange: {
				min: number;
				max: number;
				default: number;
			} | null = null;
			if (originalIsVariable) {
				try {
					const subsetSfnt = await woff2ToSfnt(subsetBuffer);
					subsetIsVariable = isVariableFont(subsetSfnt);
					if (subsetIsVariable) {
						subsetWghtRange = readWghtAxisRange(subsetSfnt);
					}
				} catch (e) {
					console.warn(
						`   ⚠ 无法解码子集 woff2 以校验可变性（'${font.id}'）：${e instanceof Error ? e.message : e}`,
					);
				}
			}

			// 根据 variationAxes.wght 计算 CSS font-weight 新值
			let newWeightCss: string | undefined;
			if (variationAxes?.wght) {
				const w = variationAxes.wght;
				newWeightCss = typeof w === "number" ? String(w) : `${w.min} ${w.max}`;
			}

			// 可变性丢失提示
			if (originalIsVariable && !subsetIsVariable) {
				const pinned =
					variationAxes?.wght !== undefined &&
					typeof variationAxes.wght === "number";
				if (pinned) {
					console.log(
						`   ℹ '${font.id}' 已实例化为静态字重 ${variationAxes?.wght}（fvar 已移除，符合 pin 预期）。`,
					);
				} else {
					console.warn(
						`   ⚠ '${font.id}' 原为可变字体，但子集产物的 fvar 表丢失（未 pin 轴却不可变），请检查 subset-font 版本。`,
					);
				}
			} else if (originalIsVariable && subsetIsVariable && newWeightCss) {
				const actual = subsetWghtRange
					? `（实际 wght 范围 ${subsetWghtRange.min}-${subsetWghtRange.max}，默认 ${subsetWghtRange.default}）`
					: "";
				console.log(
					`   ℹ '${font.id}' 保留可变性，CSS font-weight 将 patch 为 '${newWeightCss}'${actual}。`,
				);
			}

			const hash = contentHash(subsetBuffer);
			const outFile = path.join(OUTPUT_DIR, `${hash}.woff2`);
			await fs.writeFile(outFile, subsetBuffer);

			const sizeKB = (subsetBuffer.length / 1024).toFixed(1);
			const originalSizeKB = (fontBuffer.length / 1024).toFixed(1);
			const ratio = (
				((fontBuffer.length - subsetBuffer.length) / fontBuffer.length) *
				100
			).toFixed(1);

			console.log(
				`   ✔ ${hash}.woff2 (${sizeKB} KB, original: ${originalSizeKB} KB, saved ${ratio}%)`,
			);

			results.push({
				id: font.id,
				family: font.family,
				weight: font.weight,
				style: font.style,
				display: font.display,
				hash,
				format: originalFormat,
				originalSrc: font.src,
				originalHash: fullHash(fontBuffer),
				originalSize: fontBuffer.length,
				variationAxes:
					variationAxes && originalIsVariable ? variationAxes : undefined,
				newWeightCss,
			});
		} catch (err) {
			console.error(`   ❌ Failed to subset '${font.id}':`, err);
		}
	}

	if (results.length === 0) {
		console.warn("⚠ No subsets were generated.");
		return;
	}

	// 5. 找到 Astro 复制到 dist/ 的原字体，并替换 CSS/HTML 引用。
	//    本地字体会被 Astro 重命名为哈希文件名，不能直接根据源路径定位。
	console.log("🔄 Replacing original font URLs in dist/ CSS and HTML files...");
	const filesToReplace = await glob(`${DIST_DIR}/**/*.{css,html}`);
	const distFontFiles = await glob(`${DIST_DIR}/**/*.{ttf,otf,woff,woff2}`, {
		nodir: true,
	});
	const originalFilesByResult = new Map<SubsetResult, string[]>();

	for (const result of results) {
		const originalFiles: string[] = [];

		for (const distFontFile of distFontFiles) {
			const stat = await fs.stat(distFontFile);
			if (stat.size !== result.originalSize) continue;

			if (fullHash(await fs.readFile(distFontFile)) === result.originalHash) {
				originalFiles.push(distFontFile);
			}
		}

		originalFilesByResult.set(result, originalFiles);
		if (originalFiles.length === 0) {
			console.warn(
				`   ⚠ Original asset for '${result.id}' was not found in dist/.`,
			);
		}
	}

	for (const file of filesToReplace) {
		let content = await fs.readFile(file, "utf-8");
		let replaced = false;

		for (const result of results) {
			const subsetUrl = `/_astro/fonts/${result.hash}.woff2`;
			const originalFiles = originalFilesByResult.get(result) ?? [];

			for (const originalFile of originalFiles) {
				const relativePath = path
					.relative(DIST_DIR, originalFile)
					.split(path.sep)
					.join("/");
				const originalUrl = `/${relativePath}`;

				if (!content.includes(originalUrl)) continue;

				const originalExtension = path
					.extname(originalFile)
					.slice(1)
					.toLowerCase();
				content = content
					.replaceAll(
						`url("${originalUrl}") format("${result.format}")`,
						`url("${subsetUrl}") format("woff2")`,
					)
					.replaceAll(
						`href="${originalUrl}" as="font" type="font/${originalExtension}"`,
						`href="${subsetUrl}" as="font" type="font/woff2"`,
					)
					.replaceAll(originalUrl, subsetUrl);
				replaced = true;
			}
		}

		// 5b. 对可变字体 patch CSS @font-face 的 font-weight 声明，
		//     使其匹配 variationAxes.wght 裁剪后的范围。
		//     此时 URL 已替换为 subsetUrl，据此定位对应的 @font-face 块。
		//     dist 中 CSS 为压缩单行，块内无嵌套大括号，可用 [^}]* 匹配块体。
		for (const result of results) {
			if (!result.newWeightCss) continue;
			const subsetUrl = `/_astro/fonts/${result.hash}.woff2`;
			if (!content.includes(subsetUrl)) continue;

			content = content.replace(/@font-face\{[^}]*\}/g, (block) => {
				if (!block.includes(subsetUrl)) return block;
				const patched = block.replace(
					/font-weight:[^;}]+;/,
					`font-weight:${result.newWeightCss};`,
				);
				if (patched !== block) {
					console.log(
						`   ✔ Patched font-weight → '${result.newWeightCss}' in @font-face for '${result.id}'`,
					);
					replaced = true;
					return patched;
				}
				// 块中无 font-weight 声明（罕见），追加一条
				const withWeight = block.replace(
					/(src:[^;}]+;)/,
					`$1font-weight:${result.newWeightCss};`,
				);
				if (withWeight !== block) {
					console.log(
						`   ✔ Appended font-weight: '${result.newWeightCss}' to @font-face for '${result.id}'`,
					);
					replaced = true;
					return withWeight;
				}
				return block;
			});
		}

		if (replaced) {
			await fs.writeFile(file, content);
			console.log(`   ✔ Updated: ${file}`);
		}
	}

	// 6. 清理 dist/ 中的原始字体文件，避免大文件进入部署包
	console.log("🗑 Cleaning up original font files from dist/...");
	for (const originalFiles of originalFilesByResult.values()) {
		for (const originalFile of originalFiles) {
			await fs.unlink(originalFile);
			console.log(`   ✔ Removed: ${originalFile}`);
		}
	}

	console.log("✨ Font subsetting completed!");
}

main().catch((err) => {
	console.error("❌ Font subsetting failed:", err);
	process.exit(1);
});
