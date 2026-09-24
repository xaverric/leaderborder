export const isAppPath = (pathname) => pathname === "/app" || pathname.startsWith("/app/");

export const serveApp = (request, env) => env.ASSETS.fetch(new Request(new URL("/app.html", request.url)));
