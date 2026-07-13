import { friendsPageConfig } from "@/config";
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
	if (!isOgEnabled("friends")) {
		return new Response(null, { status: 404 });
	}

	const meta = resolveOgMeta("friends", {
		title: friendsPageConfig.title || i18n(I18nKey.friends),
		description:
			friendsPageConfig.description || i18n(I18nKey.friendsDescription),
	});

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
