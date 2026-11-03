// Relais Cloudflare pour TaM to Move (page web).
// Les serveurs TaM n'autorisent pas la lecture depuis un navigateur (pas d'en-tête CORS) :
// ce relais récupère UNIQUEMENT les 3 flux publics TaM et ajoute l'autorisation.
const FLUX = {
  "/trip-updates": "https://gtfsproxy.e-tam.fr/COMMON/TripUpdate.pb",
  "/alerts": "https://gtfsproxy.e-tam.fr/COMMON/Alert.pb",
  "/vehicles": "https://gtfsproxy.e-tam.fr/COMMON/VehiclePosition.pb",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const cible = FLUX[path];
    if (!cible) {
      return new Response("TaM to Move – relais. Chemins : " + Object.keys(FLUX).join(", "), {
        status: path === "" ? 200 : 404, headers: { ...CORS, "content-type": "text/plain; charset=utf-8" },
      });
    }
    // Cache de 15 s : la TaM n'est interrogée qu'une fois par période, quel que soit le nombre de visiteurs
    const cache = caches.default;
    const cle = new Request(cible);
    let rep = await cache.match(cle);
    if (!rep) {
      const r = await fetch(cible, { headers: { "User-Agent": "TamToMove-relais/1.0" }, cf: { cacheTtl: 15 } });
      if (!r.ok) return new Response("TaM indisponible", { status: 502, headers: CORS });
      rep = new Response(await r.arrayBuffer(), {
        headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=15" },
      });
      ctx.waitUntil(cache.put(cle, rep.clone()));
    }
    const out = new Response(rep.body, rep);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
};
