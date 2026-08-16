// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { buildIgdbRequest, readBoundedJson } from "../_shared/validation.js"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { operation, params } = await readBoundedJson(req)
    const { endpoint, query } = buildIgdbRequest(operation, params || {})

    const CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID')!
    const CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET')!
    if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('IGDB credentials are not configured')

    const tokenRes = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' })
    if (!tokenRes.ok) throw new Error(`IGDB token request failed (${tokenRes.status})`)
    const tokenData = await tokenRes.json()

    const igdbRes = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/json',
      },
      body: query
    })

    // Safely parse the response (IGDB sometimes sends text instead of JSON for errors)
    const responseText = await igdbRes.text()
    let data;
    try {
      data = JSON.parse(responseText);
    } catch(e) {
      data = { error: responseText || "Invalid JSON from IGDB" };
    }

    return new Response(JSON.stringify(data), { 
      status: igdbRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  } catch (error) {
    const status = error instanceof TypeError ? 400 : 500
    return new Response(JSON.stringify({ error: status === 400 ? error.message : 'Internal server error' }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
