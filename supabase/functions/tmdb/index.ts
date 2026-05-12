// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { path } = await req.json()
    if (!path) throw new Error('Missing path')

    const url = new URL(`https://api.themoviedb.org/3${path}`)
    url.searchParams.append('api_key', Deno.env.get('VITE_TMDB_KEY')!)

    const response = await fetch(url.toString())
    const data = await response.json()
    
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
