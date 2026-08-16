// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { assertAllowedTmdbRequest, enforceRateLimit, readBoundedJson } from "../_shared/validation.js"
import { enforceDurableRateLimit } from "../_shared/durableQuota.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    enforceRateLimit(req, { keyPrefix: 'tmdb', limit: 90 })
    await enforceDurableRateLimit(req, 'tmdb', 90)
    const body = await readBoundedJson(req)
    const { path, query } = assertAllowedTmdbRequest(body.path, body.query || {})

    const apiKey = Deno.env.get('TMDB_API_KEY')
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
    const status = error.status || (error instanceof TypeError ? 400 : 500)
    return new Response(JSON.stringify({ error: status === 400 || status === 429 ? error.message : 'Internal server error' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Content-Encoding': 'identity', ...(status === 429 ? { 'Retry-After': String(error.retryAfterSeconds) } : {}) }
    })
  }
})
