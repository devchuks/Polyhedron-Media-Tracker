// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { assertAllowedMetronPath, readBoundedJson } from "../_shared/validation.js"

const METRON_BASE = "https://metron.cloud";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Parse the incoming request
    const body = await readBoundedJson(req);
    const path = assertAllowedMetronPath(body.endpoint || body.path || '');

    // 2. Verify credentials exist
    const USERNAME = Deno.env.get('METRON_USERNAME');
    const PASSWORD = Deno.env.get('METRON_PASSWORD');
    if (!USERNAME || !PASSWORD) {
      console.error("[Metron Edge] Missing server credentials");
      return new Response(
        JSON.stringify({ error: "Metron credentials not configured on server." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = btoa(`${USERNAME}:${PASSWORD}`);
    const url = `${METRON_BASE}/api${path}`;

    console.log(`[Metron Edge] Fetching allowlisted path ${new URL(url).pathname}`);

    // 3. Call Metron API
    const metronResp = await fetch(url, {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Accept': 'application/json',
      },
    });

    console.log(`[Metron Edge] Metron responded with status: ${metronResp.status}`);

    // 4. Handle non-2xx responses by forwarding the Metron error to the caller
    if (!metronResp.ok) {
      console.error(`[Metron Edge] Metron returned status ${metronResp.status}.`);
      return new Response(
        JSON.stringify({
          error: `Metron API returned ${metronResp.status}`,
        }),
        {
          status: metronResp.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 5. Parse and return the successful response
    const data = await metronResp.json();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("[Metron Edge] Unhandled error:", error);
    const status = error instanceof TypeError ? 400 : 500;
    return new Response(
      JSON.stringify({ error: status === 400 ? error.message : 'Internal server error' }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
