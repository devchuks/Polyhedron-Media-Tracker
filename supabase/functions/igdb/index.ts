// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { endpoint, query } = await req.json()
    
    // Strip any leading slashes (e.g. '/multiquery' becomes 'multiquery')
    const cleanEndpoint = (endpoint || 'games').replace(/^\//, '')

    const CLIENT_ID = Deno.env.get('VITE_TWITCH_CLIENT_ID')!
    const CLIENT_SECRET = Deno.env.get('VITE_TWITCH_CLIENT_SECRET')!

    const tokenRes = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' })
    const tokenData = await tokenRes.json()

    const igdbRes = await fetch(`https://api.igdb.com/v4/${cleanEndpoint}`, {
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
