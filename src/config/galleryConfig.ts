import type { GalleryConfig } from "@/types/galleryConfig";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	albums: [
		// 支持jpg/png/webp/avif/gif格式
		// id: 相册唯一标识符（用于目录命名和URL路径），比如设置：id: "firefly-2026", 对应 public/gallery/firefly-2026/目录
		// cover: 手动指定封面图（可选，不填会把cover.*文件作为封面图，如果没有cover.*文件，则使用第一张图片作为封面图）
		// name: 相册名称
		// description: 相册描述
		// location: 相册拍摄地点
		// date: 相册日期，格式为 YYYY-MM-DD，用于排序和显示
		// tags: 相册标签，用于分类和过滤
		// password: 访问密码，设置后需要输入密码才能查看相册内容（可选）
		// passwordHint: 密码提示，设置后在输入密码错误时显示（可选，需配合password使用）
		// thumbnail: 相册缩略图配置（可选）
		// thumbnail.enabled: 是否启用缩略图 URL 转换（默认 false）
		// thumbnail.rule: 模板字符串规则（仅在 enabled=true 时生效，本地图片不进行转换）
		//   示例基准 URL: https://img.example.com/gallery/a/b/photo.jpg?x=1#top
		//   可用占位符：
		//   ${url} 原始完整 URL（含 query/hash），示例值: https://img.example.com/gallery/a/b/photo.jpg?x=1#top
		//   ${fullBase} 去掉 query/hash 后的 URL（保留扩展名），示例值: https://img.example.com/gallery/a/b/photo.jpg
		//   ${base} 去掉 query/hash 且去掉扩展名后的 URL，示例值: https://img.example.com/gallery/a/b/photo
		//   ${query} 查询参数（含 ?，不存在为空），示例值: ?x=1
		//   ${hash} 锚点（含 #，不存在为空），示例值: #top
		//   ${origin} URL 源（如 https://example.com，相对路径为空），示例值: https://img.example.com
		//   ${pathname} URL 路径（不含 query/hash），示例值: /gallery/a/b/photo.jpg
		//   ${dir} 目录（到最后一个 / 为止），示例值: https://img.example.com/gallery/a/b/
		//   ${fileName} 文件名（含扩展名），示例值: photo.jpg
		//   ${basename} 文件名（不含扩展名），示例值: photo
		//   ${ext} 扩展名（不含 .），示例值: jpg
		//   示例：
		//   原图 URL: https://img.example.com/gallery/a/b/photo.jpg?x=1#top
		//   若 rule: "${base}.md.${ext}${query}${hash}"
		//   则结果: https://img.example.com/gallery/a/b/photo.md.jpg?x=1#top
		// 每添加一个数组项就相当于添加了一个相册，记得在 public/gallery/ 目录下创建对应的子目录并放入图片
		{
			id: "firefly-2026",
			name: "可爱流萤",
			description: "飞萤之火自无梦的长夜亮起，绽放在终竟的明天。",
			location: "崩坏：星穹铁道",
			date: "2026-01-01",
			tags: ["崩坏星穹铁道", "流萤"],
			thumbnail: {
				enabled: true,
				rule: "${base}.md.${ext}${query}${hash}",
			},
		},
		{
			id: "encrypted-test",
			name: "加密相册示例",
			description:
				"这是一个加密相册的示例，设置了访问密码，只有输入正确的密码才能查看相册内容。",
			location: "崩坏：星穹铁道",
			date: "2026-02-01",
			tags: ["加密相册", "示例"],
			password: "123456",
			passwordHint: "示例密码123456",
		},
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,
};
