import type { Messages } from "@/i18n/messages";
import { getI18n } from "@/i18n/server";
import { HTML_LANG, type Locale } from "@/lib/locale";

// A route handler, not a page: Next ignores the status of a proxy rewrite to a page, while a
// handler's own status survives. Both the proxy (owner-only paths) and requireStaff (wrong role in
// a page or action) end here, so every refusal is a real HTTP 403. Plain HTML, no session read: the
// language comes from the proxy's header.
function page(t: Messages, locale: Locale): string {
  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${t.forbidden.title} | ${t.app.name}</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; }
main { max-width: 24rem; margin: 0 auto; padding: 3rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
h1 { font-size: 1.5rem; margin: 0; }
p { margin: 0; opacity: 0.75; }
a { display: inline-flex; align-items: center; min-height: 44px; color: inherit; }
</style>
</head>
<body>
<main>
<h1>${t.forbidden.title}</h1>
<p>${t.forbidden.text}</p>
<a href="/today">${t.forbidden.back}</a>
</main>
</body>
</html>`;
}

async function forbiddenResponse(): Promise<Response> {
  const { t, locale } = await getI18n();
  return new Response(page(t, locale), {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const GET = forbiddenResponse;
// A Server Action refused by the proxy arrives as POST.
export const POST = forbiddenResponse;
