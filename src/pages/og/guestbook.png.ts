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
	if (!isOgEnabled("guestbook")) {
		return new Response(null, { status: 404 });
	}

	const meta = resolveOgMeta("guestbook", {
		title: i18n(I18nKey.guestbook),
		description: i18n(I18nKey.guestbookDescription),
	});

	const png = await renderOgImage({
		title: meta.title,
		description: meta.description,
	});

	return new Response(png, { headers: ogImageResponseHeaders });
}
