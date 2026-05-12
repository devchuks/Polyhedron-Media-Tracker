// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { endpoint } = await req.json()
    
    const USERNAME = Deno.env.get('VITE_METRON_USERNAME')!
    const PASSWORD = Deno.env.get('VITE_METRON_PASSWORD')!

    const credentials = btoa(`${USERNAME}:${PASSWORD}`)
    const response = await fetch(`https://metron.cloud${endpoint}`, {
      headers: { 'Authorization': `Basic ${credentials}`, 'Accept': 'application/json' }
    })
    
    const data = await response.json()
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
  }
})
