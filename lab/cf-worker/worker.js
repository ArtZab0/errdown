// errdown capture lab: deliberately triggers Cloudflare Worker errors.
// /throw -> uncaught exception (expect 1101)
// /cpu   -> exceeds CPU limit  (expect 1102)
// /ok    -> 200 control
export default {
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/throw") throw new Error("errdown lab: intentional exception");
    if (path === "/cpu") {
      let x = 0;
      const end = Date.now() + 60_000;
      while (Date.now() < end) x += Math.sqrt(x + 1);
      return new Response(String(x));
    }
    return new Response("ok\n");
  },
};
