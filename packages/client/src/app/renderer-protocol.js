export const RENDERER_URL = "leaderborder://app/index.html";

const ASSETS = new Map([
  ["leaderborder://app/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["leaderborder://app/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["leaderborder://app/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["leaderborder://app/tokens.css", { file: "tokens.css", type: "text/css; charset=utf-8" }],
]);

export const createRendererHandler = (readAsset) => async (request) => {
  const asset = ASSETS.get(request.url);
  if (request.method !== "GET" || !asset) return new Response(null, { status: 404 });
  return new Response(await readAsset(asset.file), { headers: { "content-type": asset.type } });
};
