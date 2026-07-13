import { siteConfig } from "@/config";
import {
	isOgEnabled,
	ogImageResponseHeaders,
	renderOgImage,
	resolveOgMeta,
} from "@/utils/og-utils";

export const prerender = true;

export async function GET(): Promise<Response> {
	if (!isOgEnabled("index")) {
		return new Response(null, { status: 404 });
	}

	const meta = resolveOgMeta("index", {
		title: siteConfig.title,
		description: siteConfig.subtitle || siteConfig.description || "",
	});

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
		footerRight: siteConfig.subtitle || undefined,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
