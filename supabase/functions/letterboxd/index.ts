// /supabase/functions/letterboxd/index.ts
// Reads a public Letterboxd diary feed for signed-in users (browsers cannot fetch it directly).
// The upstream host is fixed, the username is validated, and the response size is bounded.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { enforceRateLimit, readBoundedJson } from "../_shared/validation.js";
import { assertLetterboxdUsername, parseLetterboxdFeed } from "../_shared/letterboxdFeed.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MAX_FEED_BYTES = 2_000_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Sign-in is required at the gateway; the database quota (consume_edge_quota) only knows the
    // original provider scopes, so this read-only feed proxy uses the per-instance limit.
    enforceRateLimit(req, { keyPrefix: 'letterboxd', limit: 30 });
    const { username } = await readBoundedJson(req);
    const safeUsername = assertLetterboxdUsername(username);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let feedRes: Response;
    try {
      feedRes = await fetch(`https://letterboxd.com/${safeUsername}/rss/`, {
        headers: { Accept: "application/rss+xml, application/xml", "User-Agent": "Polyhedron diary sync" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!feedRes.ok) {
      const status = feedRes.status === 404 ? 404 : 502;
      return new Response(JSON.stringify({ error: status === 404 ? 'Letterboxd profile not found' : 'Letterboxd is unavailable' }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xml = await feedRes.text();
    if (xml.length > MAX_FEED_BYTES) throw Object.assign(new Error('Letterboxd feed is too large'), { status: 502 });

    return new Response(JSON.stringify({ entries: parseLetterboxdFeed(xml) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Letterboxd Edge] Error:", err?.message || err);
    const status = err.status || (err instanceof TypeError ? 400 : 500);
    return new Response(JSON.stringify({ error: status === 400 || status === 429 ? err.message : 'Internal server error' }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json", ...(status === 429 ? { "Retry-After": String(err.retryAfterSeconds) } : {}) },
    });
  }
});
