// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { endpoint, query } = await req.json()
    
    const CLIENT_ID = Deno.env.get('VITE_TWITCH_CLIENT_ID')!
    const CLIENT_SECRET = Deno.env.get('VITE_TWITCH_CLIENT_SECRET')!

    const tokenRes = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' })
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

    const data = await igdbRes.json()
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
