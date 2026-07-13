import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";
import type { APIContext, GetStaticPaths } from "astro";
import {
	isOgEnabled,
	ogImageResponseHeaders,
	renderOgImage,
	resolveOgMeta,
} from "@/utils/og-utils";
import { removeFileExtension } from "@/utils/url-utils";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
	if (!isOgEnabled("posts")) {
		return [];
	}

	const allPosts = await getCollection("posts");
	const publishedPosts = allPosts.filter((post) => !post.data.draft);

	return publishedPosts.map((post) => {
		const slug = removeFileExtension(post.id);
		return {
			params: { slug: `${slug}.png` },
			props: { post },
		};
	});
};

export async function GET({
	props,
}: APIContext<{ post: CollectionEntry<"posts"> }>): Promise<Response> {
	const { post } = props;

	const pubDate = post.data.published.toLocaleDateString("zh", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});

	const meta = resolveOgMeta("posts", {
		title: post.data.title,
		description: post.data.description,
	});

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
		footerRight: pubDate,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
