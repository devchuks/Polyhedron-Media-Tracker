// /supabase/functions/vn/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildVndbRequest, readBoundedJson } from "../_shared/validation.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { operation, params } = await readBoundedJson(req);
    const body = buildVndbRequest(operation, params || {});

    const vndbRes = await fetch("https://api.vndb.org/kana/vn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!vndbRes.ok) {
      console.error("[VN Edge] VNDB returned status:", vndbRes.status);
      return new Response(JSON.stringify({ error: `VNDB returned status ${vndbRes.status}` }), {
        status: vndbRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await vndbRes.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[VN Edge] Internal error:", err);
    const status = err instanceof TypeError ? 400 : 500;
    return new Response(JSON.stringify({ error: status === 400 ? err.message : 'Internal server error' }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
