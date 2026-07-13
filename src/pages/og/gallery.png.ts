import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	isOgEnabled,
	ogImageResponseHeaders,
	renderOgImage,
	resolveOgMeta,
} from "@/utils/og-utils";

export const prerender = true;

export async function GET(): Promise<Response> {
	if (!isOgEnabled("gallery")) {
		return new Response(null, { status: 404 });
	}

	const meta = resolveOgMeta("gallery", {
		title: i18n(I18nKey.gallery),
		description: i18n(I18nKey.galleryDescription),
	});

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
