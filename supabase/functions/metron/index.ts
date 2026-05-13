// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

const METRON_BASE = "https://metron.cloud";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Parse the incoming request
    const body = await req.json();
    let path = body.endpoint || body.path || '';

    // Remove any leading "/api" that the caller might include, because we are
    // always going to prepend /api ourselves.  This makes the edge function
    // forgiving whether the frontend sends /api/issue/… or just /issue/…
    if (path.startsWith('/api/')) {
      path = path.slice(4); // strip /api
    }
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    // 2. Verify credentials exist
    const USERNAME = Deno.env.get('VITE_METRON_USERNAME');
    const PASSWORD = Deno.env.get('VITE_METRON_PASSWORD');
    if (!USERNAME || !PASSWORD) {
      console.error("[Metron Edge] Missing environment variables VITE_METRON_USERNAME / VITE_METRON_PASSWORD");
      return new Response(
        JSON.stringify({ error: "Metron credentials not configured on server." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const credentials = btoa(`${USERNAME}:${PASSWORD}`);
    const url = `${METRON_BASE}/api${path}`;

    console.log(`[Metron Edge] Fetching: ${url}`);

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
      let errorBody = '';
      const contentType = metronResp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        errorBody = JSON.stringify(await metronResp.json());
      } else {
        errorBody = await metronResp.text();
      }
      console.error(`[Metron Edge] Metron error (${metronResp.status}):`, errorBody);
      return new Response(
        JSON.stringify({
          error: `Metron API returned ${metronResp.status}`,
          details: errorBody,
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
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});