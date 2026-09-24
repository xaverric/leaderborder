export const jsonResponse = (body, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const fakeFetch = (replies, calls = []) => {
  const queue = [...replies];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(url, init);
    return next instanceof Response ? next : jsonResponse(next);
  };
  return Object.assign(fetch, { calls });
};
