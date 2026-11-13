import { ru } from "@/i18n/ru";

// A route handler, not a page: Next ignores the status of a proxy rewrite to a page, while a
// handler's own status survives. Both the proxy (owner-only paths) and requireStaff (wrong role in
// a page or action) end here, so every refusal is a real HTTP 403. Plain HTML, no session read.
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${ru.forbidden.title} | ${ru.app.name}</title>
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
<h1>${ru.forbidden.title}</h1>
<p>${ru.forbidden.text}</p>
<a href="/today">${ru.forbidden.back}</a>
</main>
</body>
</html>`;

function forbiddenResponse(): Response {
  return new Response(html, {
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
