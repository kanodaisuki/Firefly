// 相册元信息（用户在配置文件中填写）
export type GalleryAlbum = {
	id: string; // URL slug + 目录名，如 "japan-2025"
	name: string; // 相册名称
	description?: string; // 相册描述
	date?: string; // 日期
	location?: string; // 拍摄地点
	tags?: string[]; // 标签（用于首页筛选）
	cover?: string; // 手动指定封面（可选，省略则自动取 cover.* 或第一张）
	password?: string; // 加密密码（非空时启用加密）
	passwordHint?: string; // 密码提示
	comment?: boolean; // 是否启用评论（可选，默认 false）
};

export type GalleryIndexLayoutConfig = {
	enableSearch?: boolean; // 是否启用相册搜索，默认 true
	enableTagFilter?: boolean; // 是否启用标签筛选，默认 true
};

export type GalleryPaginationConfig = {
	enabled?: boolean; // 是否开启分页，默认 false
	albumsPerPage?: number; // 每页相册数量，默认 12
};

// 相册配置
export type GalleryConfig = {
	albums: GalleryAlbum[];
	columnWidth?: number; // 瀑布流最小列宽(px)，默认 240，浏览器根据容器宽度自动计算列数
	indexLayout?: GalleryIndexLayoutConfig; // 相册首页布局配置
	pagination?: GalleryPaginationConfig; // 相册分页配置
};
