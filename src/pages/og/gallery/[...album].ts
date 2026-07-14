import type { APIContext, GetStaticPaths } from "astro";
import { type GalleryAlbum, galleryConfig } from "@/config";
import {
	isOgEnabled,
	ogImageResponseHeaders,
	renderOgImage,
	resolveOgMeta,
} from "@/utils/og-utils";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
	if (!isOgEnabled("galleryAlbum")) {
		return [];
	}

	return galleryConfig.albums.map((album) => ({
		params: { album: `${album.id}.png` },
		props: { album },
	}));
};

export async function GET({
	props,
}: APIContext<{ album: GalleryAlbum }>): Promise<Response> {
	const { album } = props;

	const meta = resolveOgMeta("galleryAlbum", {
		title: album.name,
		description: album.description || "",
	});

	const albumDate = album.date
		? new Date(album.date).toLocaleDateString("zh", {
				year: "numeric",
				month: "short",
				day: "numeric",
			})
		: null;

	const footerRight = albumDate || album.location || undefined;

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
		footerRight,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
