// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const bodyText = await req.text()
    const body = bodyText ? JSON.parse(bodyText) : {}
    const { path, query = {} } = body

    if (!path) throw new Error('Missing "path" parameter in request body')

    const apiKey = Deno.env.get('VITE_TMDB_KEY') || Deno.env.get('TMDB_API_KEY')
    if (!apiKey) throw new Error('TMDB API Key is not configured')

    const url = new URL(`https://api.themoviedb.org/3${path.startsWith('/') ? path : `/${path}`}`)
    url.searchParams.append('api_key', apiKey)
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.append(key, String(value))
    }

    // 1. Tell TMDB we want plain JSON, no compression
    const tmdbRes = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        'User-Agent': 'curl/8.0.0'
      }
    })

    // 2. Read the raw body as an array buffer
    const buffer = await tmdbRes.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    // 3. Check if it's gzipped (magic bytes 0x1F 0x8B)
    const isGzipped = bytes.length >= 2 && bytes[0] === 0x1F && bytes[1] === 0x8B

    let jsonText: string
    if (isGzipped) {
      // Decompress using Deno's built-in gzip support
      const decompressed = await new Response(buffer).arrayBuffer()
      jsonText = new TextDecoder().decode(decompressed)
    } else {
      jsonText = new TextDecoder().decode(buffer)
    }

    let data
    try {
      data = JSON.parse(jsonText)
    } catch (parseErr) {
      console.error("Raw response (first 500 chars):", jsonText.slice(0, 500))
      throw new Error(`TMDB returned invalid JSON: ${parseErr.message}`)
    }

    // 4. Return JSON with headers that prevent re‑compression
    const responseHeaders = {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-transform'
    }

    if (!tmdbRes.ok) {
      return new Response(JSON.stringify(data), { status: tmdbRes.status, headers: responseHeaders })
    }

    return new Response(JSON.stringify(data), { headers: responseHeaders })
  } catch (error) {
    console.error("Edge Function error:", error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Content-Encoding': 'identity' }
    })
  }
})