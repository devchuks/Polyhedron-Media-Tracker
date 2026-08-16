// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0"
import { escapeTelegramHtml, readBoundedJson, safeHttpUrl, verifyTelegramWebhookSecret } from "../_shared/validation.js"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');

  // Telegram webhooks are always POST requests
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const providedWebhookSecret = req.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!verifyTelegramWebhookSecret(providedWebhookSecret, TELEGRAM_WEBHOOK_SECRET || '')) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  if (!TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) {
    console.error('Telegram logger configuration is incomplete.');
    return new Response('Configuration Error', { status: 500, headers: corsHeaders });
  }

  try {
    const body = await readBoundedJson(req, 32_000);
    if (!Number.isSafeInteger(body.update_id)) {
      return new Response('Invalid Telegram update identifier.', { status: 400, headers: corsHeaders });
    }

    // 1. Payload Extraction
    // Telegram wraps the actual message in an update object
    const message = body.message || body.edited_message;

    if (!message) {
      // If there's no message (e.g., a different type of update), just acknowledge it.
      return new Response('OK', { status: 200, headers: corsHeaders });
    }

    // 2. Identity Verification (Security Gate)
    const chatId = message.chat?.id;
    
    // Strict comparison. String() is used because TELEGRAM_CHAT_ID from Deno.env is a string,
    // but message.chat.id from Telegram is an integer.
    if (String(chatId) !== TELEGRAM_CHAT_ID) {
      console.warn('Rejected a Telegram update from an unauthorized chat.');
      // Return 200 to safely close the connection and prevent Telegram from retrying the webhook
      return new Response('Unauthorized, but acknowledged.', { status: 200, headers: corsHeaders });
    }

    // 3. Payload Parsing Setup
    const rawText = message.text || '';
    const timestamp = message.date; // Unix timestamp provided by Telegram

    if (!rawText) {
      return new Response('No text provided.', { status: 200, headers: corsHeaders });
    }

    // Input sanitization: limit length to prevent massive token usage/injection bloat
    const text = rawText.slice(0, 1000).trim();

    console.log(`Received authorized Telegram update ${body.update_id ?? 'unknown'} at ${timestamp}.`);

// --- Phase 2 - LLM Parsing Engine (Gemini 2.0 Flash Structured Outputs) ---

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

if (!GEMINI_API_KEY) {
  console.error("[Phase 2] CRITICAL: GEMINI_API_KEY is missing!");
  return new Response('LLM Configuration Error', {
    status: 200,
    headers: corsHeaders
  });
}

// Updated Gemini endpoint
const geminiUrl =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Light sanitization to reduce prompt injection / token abuse
const sanitizedText = String(text)
  .replace(/\0/g, '')
  .trim()
  .slice(0, 1500);

const systemPrompt = `
You are a structured media parsing engine.

Extract semantic media logging information from the user's message.
If the user mentions multiple media items, extract EACH ONE as a separate object in the 'items' array.
If the user expresses a general intent for a list (e.g. "add these to my backlog", "I want to watch..."), apply that action to ALL items in the list.

Rules:
- Return ONLY valid structured JSON.
- Never include markdown.
- Do not invent missing information.
- If uncertain, return null for the field.
- CRITICAL: If the media is a Japanese Anime (whether a series or a movie), ALWAYS classify the type as 'anime'. Do NOT classify anime as 'tv' or 'movies'.
- Confidence must be a number between 0 and 1.
- Preserve the user's intent accurately.
`;

console.log(`[Phase 2] Invoking Gemini Structured Output Parser...`);

const geminiRes = await fetch(geminiUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    systemInstruction: {
      role: "system",
      parts: [{ text: systemPrompt }]
    },

    contents: [
      {
        role: "user",
        parts: [{ text: sanitizedText }]
      }
    ],

    generationConfig: {
      temperature: 0.1,
      topK: 20,
      topP: 0.8,

      // Modern structured outputs
      responseMimeType: "application/json",

      responseSchema: {
        type: "OBJECT",
        properties: {
          items: {
            type: "ARRAY",
            description: "A list of media items extracted from the user's message. Multiple items can be extracted.",
            items: {
              type: "OBJECT",
              properties: {
                action: {
                  type: "STRING",
                  nullable: true,
                  description:
                    "The user's intent. Use 'planned' (want to consume, add to watchlist/backlog), 'in progress' (currently consuming), 'completed' (finished consuming), or 'dropped'.",
                  enum: ["planned", "in progress", "completed", "dropped"]
                },
                cleanTitle: {
                  type: "STRING",
                  description:
                    "Media title with years, season labels, and issue markers removed."
                },
                year: {
                  type: "INTEGER",
                  nullable: true,
                  description:
                    "Release year explicitly mentioned by the user."
                },
                season: {
                  type: "INTEGER",
                  nullable: true,
                  description:
                    "Season number or volume number explicitly mentioned."
                },
                progressNumber: {
                  type: "NUMBER",
                  nullable: true,
                  description:
                    "Episode number, issue number, chapter number, or completion percentage. Do NOT put the season number here."
                },
                progressUnit: {
                  type: "STRING",
                  nullable: true,
                  enum: [
                    "episode", "issue", "chapter", "percentage", "season"
                  ]
                },
                type: {
                  type: "STRING",
                  nullable: true,
                  enum: [
                    "tv", "movies", "comics", "games", "anime", "manga", "vn", "books"
                  ]
                },
                rawRating: {
                  type: "NUMBER",
                  nullable: true,
                  description: "Numeric rating value supplied by the user."
                },
                rawRatingScale: {
                  type: "INTEGER",
                  nullable: true,
                  description: "Rating scale denominator such as 5 or 10."
                },
                reviewText: {
                  type: "STRING",
                  nullable: true,
                  description: "Freeform review or notes from the user."
                },
                confidence: {
                  type: "NUMBER",
                  description: "Confidence score from 0.0 to 1.0."
                }
              },
              required: ["cleanTitle", "confidence"]
            }
          }
        },
        required: ["items"]
      }
    }
  })
});

if (!geminiRes.ok) {
  console.error(`[Phase 2] Gemini API Error (${geminiRes.status}).`);

  return new Response('Gemini API request failed.', {
    status: 200,
    headers: corsHeaders
  });
}

const geminiData = await geminiRes.json();

const responseText =
  geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

if (!responseText) {
  console.error("[Phase 2] Gemini failed to return structured output.");

  return new Response('Failed to parse message with LLM.', {
    status: 200,
    headers: corsHeaders
  });
}

let parsedJson;

try {
  // Structured outputs should always return valid JSON now
  parsedJson = JSON.parse(responseText);
} catch (e) {
  console.error("[Phase 2] Structured output parsing failure.");

  return new Response('LLM returned invalid structured JSON.', {
    status: 200,
    headers: corsHeaders
  });
}

let items = parsedJson.items;
// Fallback gracefully in case the LLM returns a single object instead of the array wrapper
if (!Array.isArray(items)) {
  if (parsedJson.cleanTitle) {
    items = [parsedJson];
  } else {
    items = [];
  }
}

if (items.length === 0) {
  console.warn("[Phase 2] No items extracted from the message.");
  return new Response('No items found.', { status: 200, headers: corsHeaders });
}
if (items.length > 10) {
  return new Response('Too many media items in one update.', { status: 200, headers: corsHeaders });
}

if (items.length > 1) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `⏳ Processing a batch of ${items.length} items...`
    })
  });
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY') ?? '';

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.error('Supabase logger configuration is incomplete.');
  return new Response('Configuration Error', { status: 500, headers: corsHeaders });
}

const supabase = createClient(supabaseUrl, anonKey);
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
const userId = Deno.env.get('ADMIN_USER_ID');

if (!userId) {
  console.error('[Phase 4] CRITICAL ERROR: ADMIN_USER_ID is missing from environment variables.');
  return new Response('Configuration Error', { status: 200, headers: corsHeaders }); 
}

// BATCH PROCESSING LOOP
for (let i = 0; i < items.length; i++) {
  const item = items[i];

  // Confidence guard
  const confidence = typeof item.confidence === 'number' ? item.confidence : 0;
  if (confidence < 0.35) {
    console.warn(`[Phase 2] Low confidence extraction (${confidence}) on item ${i+1}`);
  }

  // Safe Mapping from Structured Output
  const action = item.action || null;
  const cleanTitle = typeof item.cleanTitle === 'string' ? item.cleanTitle.trim() : 'Unknown Title';
  const year = item.year !== null && item.year !== undefined ? parseInt(item.year, 10) : null;
  const season = item.season !== null && item.season !== undefined ? parseInt(item.season, 10) : null;
  const issue = item.progressNumber !== null && item.progressNumber !== undefined ? Math.floor(item.progressNumber) : null;
  const progressUnit = item.progressUnit || null;

  let type = typeof item.type === 'string' ? item.type.toLowerCase() : 'unknown';
  const VALID_TYPES = ['tv', 'movies', 'comics', 'games', 'anime', 'manga', 'vn', 'books'];
  if (!VALID_TYPES.includes(type)) type = 'unknown';

  // Deterministic rating normalization
  let rating = null;
  if (item.rawRating !== null && item.rawRating !== undefined) {
    const rawValue = parseFloat(item.rawRating);
    const scale = item.rawRatingScale || (rawValue <= 5 ? 5 : 10);
    if (scale === 10) rating = rawValue;
    else if (scale === 5) rating = rawValue * 2;
    else rating = rawValue <= 5 ? rawValue * 2 : rawValue;
    rating = Math.max(0, Math.min(10, rating));
  }

  let reviewText = typeof item.reviewText === 'string' ? item.reviewText.trim() : '';

  console.log(`[Phase 2 Resolved] Item ${i+1}/${items.length} | Action: ${action} | Type: ${type} | Confidence: ${confidence}`);

  // --- Phase 3 - Autonomous API Resolution ---

    let externalId = null;
    let canonicalTitle = cleanTitle;
    let canonicalYear = year;
    let posterUrl = null;
    let seasonYear = null;
    let episodeCount = null;
    let apiMatch = null;
    let isComicSeries = false;
    let specificIssueId = null;

    if (type === 'tv' || type === 'movies') {
      const path = type === 'tv' ? '/search/tv' : '/search/movie';
      const queryParams: any = { query: cleanTitle };
      if (year) {
        if (type === 'tv') {
          // Import Terminal Logic: Don't restrict the series search to the season's year
          if (season === null && issue === null) {
            queryParams.first_air_date_year = year;
          }
        }
        else queryParams.year = year;
      }

      console.log('[Phase 3] Invoking TMDB.');
      let { data, error } = await supabase.functions.invoke('tmdb', { body: { path, query: queryParams } });
      
      // Fallback: If TMDB strict year search returns nothing, retry without the year constraint
      if (data?.results?.length === 0 && year) {
        console.log('[Phase 3] Strict TMDB search failed; retrying without year.');
        const fallbackRes = await supabase.functions.invoke('tmdb', { body: { path, query: { query: cleanTitle } } });
        data = fallbackRes.data;
        error = fallbackRes.error || error;
      }
      
      if (error) console.error('[Phase 3] TMDB Error:', error);
      if (data?.results?.length > 0) {
        const match = data.results[0];
        externalId = match.id;
        
        // Deep-fetch full details to prevent frontend dashboard crashes
        const detailsPath = type === 'tv' ? `/tv/${externalId}` : `/movie/${externalId}`;
        const { data: fullDetails } = await supabase.functions.invoke('tmdb', { body: { path: detailsPath } });
        apiMatch = fullDetails || match;

        canonicalTitle = apiMatch.name || apiMatch.title;
        canonicalYear = parseInt((apiMatch.first_air_date || apiMatch.release_date || '').split('-')[0], 10) || year;
        posterUrl = apiMatch.poster_path ? `https://image.tmdb.org/t/p/w500${apiMatch.poster_path}` : null;

        // Import Terminal Logic: Auto-resolve missing season via the provided year
        if (type === 'tv' && season === null && year !== null && apiMatch.seasons) {
          const matchedSeason = apiMatch.seasons.find((s: any) =>
            s.air_date && s.air_date.startsWith(String(year)) && s.season_number > 0
          );
          if (matchedSeason && String(year) !== String(canonicalYear)) {
            season = matchedSeason.season_number;
            console.log(`[Phase 3] Auto-resolved Year ${year} to Season ${season} via Import Terminal logic.`);
          }
        }

        // Deep-fetch TV season
        if (type === 'tv' && season !== null) {
          console.log(`[Phase 3] Deep-fetching TV Season ${season} for TMDB ID ${externalId}`);
          const { data: seasonData } = await supabase.functions.invoke('tmdb', { body: { path: `/tv/${externalId}/season/${season}` } });
          if (seasonData) {
            seasonYear = parseInt((seasonData.air_date || '').split('-')[0], 10) || null;
            episodeCount = seasonData.episodes?.length || null;
          }
        }
      }
    } else if (type === 'games') {
      console.log('[Phase 3] Invoking IGDB.');
      const { data, error } = await supabase.functions.invoke('igdb', {
        body: { operation: 'searchGames', params: { query: cleanTitle, page: 1 } },
      });
      
      if (error) console.error('[Phase 3] IGDB Error:', error);
      if (data && data.length > 0) {
        let match = data[0]; // fallback to top match
        if (year) {
          const yearMatch = data.find((g: any) => g.first_release_date && new Date(g.first_release_date * 1000).getFullYear() === year);
          if (yearMatch) match = yearMatch;
        }
        
        externalId = match.id;

        // Deep-fetch full details
        const { data: fullDetails } = await supabase.functions.invoke('igdb', {
          body: { operation: 'gameDetails', params: { id: externalId } },
        });
        apiMatch = (fullDetails && fullDetails.length > 0) ? fullDetails[0] : match;

        canonicalTitle = apiMatch.name;
        if (apiMatch.first_release_date) canonicalYear = new Date(apiMatch.first_release_date * 1000).getFullYear();
        if (apiMatch.cover?.url) {
          posterUrl = apiMatch.cover.url.replace('t_thumb', 't_720p');
          if (posterUrl.startsWith('//')) posterUrl = 'https:' + posterUrl;
        }
      }
    } else if (type === 'comics') {
      console.log('[Phase 3] Invoking Metron.');
      
      // Try to resolve the specific issue ID if one was provided in the log
      if (issue !== null) {
        const specificParams = new URLSearchParams();
        specificParams.append('series_name', cleanTitle);
        specificParams.append('number', issue.toString());
        if (year) specificParams.append('cover_year', year.toString());
        const { data: specificData } = await supabase.functions.invoke('metron', { body: { path: `/api/issue/?${specificParams.toString()}` } });
        if (specificData?.results?.length > 0) {
           specificIssueId = specificData.results[0].id;
        }
      }

      // Replicating frontend logic: search by issue #1 to reliably get the Series parent ID and a high-res cover
      const issueParams = new URLSearchParams();
      issueParams.append('series_name', cleanTitle);
      issueParams.append('number', '1');
      if (year) issueParams.append('cover_year', year.toString());

      let { data, error } = await supabase.functions.invoke('metron', { body: { path: `/api/issue/?${issueParams.toString()}` } });
      
      // Fallback: If Metron strict year search returns nothing, retry without the year constraint
      if (data?.results?.length === 0 && year) {
        console.log('[Phase 3] Strict Metron search failed; retrying without year.');
        const fallbackParams = new URLSearchParams();
        fallbackParams.append('series_name', cleanTitle);
        fallbackParams.append('number', '1');
        const fallbackRes = await supabase.functions.invoke('metron', { body: { path: `/api/issue/?${fallbackParams.toString()}` } });
        data = fallbackRes.data;
        error = fallbackRes.error || error;
      }
      
      if (error) console.error('[Phase 3] Metron Error:', error);
      if (data?.results?.length > 0) {
        const match = data.results[0]; // Top issue #1 match
        
        let sId = match.series?.id ?? (typeof match.series === 'number' ? match.series : null);

        if (!sId) {
          // Fallback: fetch the issue directly to see if it reveals its series
          const { data: directIssue } = await supabase.functions.invoke('metron', { body: { path: `/api/issue/${match.id}/` } });
          sId = directIssue?.series?.id ?? (typeof directIssue?.series === 'number' ? directIssue?.series : null);
        }

        isComicSeries = !!sId;
        externalId = sId ?? match.id;
        canonicalTitle = match.series?.name ?? (typeof match.series === 'string' ? match.series : cleanTitle);

        if (isComicSeries) {
          // Deep-fetch full details ONLY if it's a series
          const { data: fullDetails } = await supabase.functions.invoke('metron', { body: { path: `/api/series/${externalId}/` } });
          apiMatch = fullDetails || match;
        } else {
          apiMatch = match;
        }

        // Ensure image is explicitly attached so frontend UI resolvers can find it
        if (apiMatch && match.image) {
          apiMatch.image = match.image;
        }
        
        let resolvedName = apiMatch?.name || canonicalTitle || cleanTitle || 'Unknown Title';
        if (typeof resolvedName !== 'string' || !resolvedName.trim()) resolvedName = 'Unknown Title';
        canonicalTitle = resolvedName.replace(/\sVol(?:ume)?\s\d+/i, '').trim();
        if (!canonicalTitle) canonicalTitle = 'Unknown Title';

        if (match.cover_date) canonicalYear = parseInt(match.cover_date.substring(0, 4), 10) || year;
        posterUrl = apiMatch?.image || match.image || null; 
      }
    } else if (type === 'anime' || type === 'manga') {
      console.log('[Phase 3] Invoking AniList.');
      const mediaType = type === 'anime' ? 'ANIME' : 'MANGA';
      const query = `query ($search: String) {
        Page(page: 1, perPage: 10) {
          media(search: $search, type: ${mediaType}, sort: [SEARCH_MATCH]) {
            id
            title { romaji english native }
            description(asHtml: true)
            coverImage { extraLarge large medium }
            bannerImage
            startDate { year month day }
            episodes
            chapters
            volumes
            status
            averageScore
            siteUrl
            genres
          }
        }
      }`;

      try {
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables: { search: cleanTitle } })
        });
        const json = await res.json();
        
        if (json.data?.Page?.media?.length > 0) {
          const results = json.data.Page.media;
          let match = results[0];
          if (year) {
            const yearMatch = results.find((m: any) => m.startDate?.year === year);
            if (yearMatch) match = yearMatch;
          }
          externalId = match.id;
          apiMatch = match;
          canonicalTitle = match.title?.english || match.title?.romaji || cleanTitle;
          canonicalYear = match.startDate?.year || year;
          posterUrl = match.coverImage?.extraLarge || match.coverImage?.large || null;
        }
      } catch (error) {
        console.error('[Phase 3] AniList Error:', error);
      }
    } else if (type === 'vn') {
      console.log('[Phase 3] Invoking VNDB.');
      try {
        const res = await fetch('https://api.vndb.org/kana/vn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: ['search', '=', cleanTitle],
            fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.name, description, length, tags.name, relations.relation, relations.id, relations.title, relations.image.url, screenshots.url, extlinks.url, extlinks.label',
            results: 10
          })
        });
        const json = await res.json();
        
        if (json.results?.length > 0) {
          const results = json.results;
          let match = results[0];
          if (year) {
            const yearMatch = results.find((m: any) => m.released && m.released.startsWith(String(year)));
            if (yearMatch) match = yearMatch;
          }
          externalId = match.id;
          apiMatch = match;
          const engTitleObj = match.titles?.find((t: any) => t.lang === 'en' || t.lang === 'eng');
          canonicalTitle = engTitleObj?.latin || engTitleObj?.title || match.title || cleanTitle;
          if (match.released) canonicalYear = parseInt(match.released.split('-')[0], 10) || year;
          // Force strict string casting to prevent corrupted object payloads
          posterUrl = match.image?.url ? String(match.image.url) : (typeof match.image === 'string' ? match.image : null);
        }
      } catch (error) {
        console.error('[Phase 3] VNDB Error:', error);
      }
    }

    console.log(`[Phase 3 Resolved] Provider match: ${externalId ? 'yes' : 'no'}.`);

    // --- Phase 4 - Database Execution and Upsert Logic ---

    const userId = Deno.env.get('ADMIN_USER_ID');
    if (!userId) {
      console.error('[Phase 4] CRITICAL ERROR: ADMIN_USER_ID is missing from environment variables.');
      return new Response('Configuration Error', { status: 200, headers: corsHeaders }); // Return 200 to satisfy Telegram
    }

    if (externalId) {
      // Match the exact ID formatting expected by your frontend
      let mediaId = String(externalId);
      if (type === 'comics') mediaId = isComicSeries ? `series_${externalId}` : `issue_${externalId}`;
      else if (type === 'games') mediaId = `igdb_${externalId}`;
      const providerByType = {
        movies: 'tmdb', tv: 'tmdb', comics: 'metron', games: 'igdb', anime: 'anilist',
        manga: 'anilist', vn: 'vndb', books: 'openlibrary',
      };
      const provider = providerByType[type];
      const providerId = type === 'comics' ? mediaId : String(externalId);
      const mediaKey = `${provider}:${type}:${providerId}`;
      
      // Advance timestamp minimally to guarantee chronological ordering in the UI 
      const timestampMs = new Date(timestamp * 1000).getTime() + i;
      const isoDate = new Date(timestampMs).toISOString();

      // Pre-fetch existing library data to feed into the Smart Completion Engine
      const { data: existingMedia } = await supabaseAdmin
        .from('media_library')
        .select('*') // Get everything to preserve existing fields safely
        .eq('media_key', mediaKey)
        .eq('user_id', userId)
        .maybeSingle();

      // Determine progress strings and milestone states dynamically
      let progressStr = null;

      let isSeriesComplete = false;
      let isSeasonComplete = false;

      // Smart status resolution based on LLM extracted action and existing media
      let safeStatus = action || existingMedia?.status || 'in progress';

      // --- SMART COMPLETION ENGINE ---
      if (apiMatch) {
        if (type === 'tv') {
          const isEnded = ['Ended', 'Canceled'].includes(apiMatch.status);
          const activeSeasons = (apiMatch.seasons || []).filter((s: any) => s.season_number > 0);
          const maxSeason = activeSeasons.length > 0 ? Math.max(...activeSeasons.map((s: any) => s.season_number)) : 1;
          
          if (season !== null) {
            const isMaxSeason = season === maxSeason;
            const seasonData = activeSeasons.find((s: any) => s.season_number === season);
            const maxEp = seasonData?.episode_count || 0;
            const hitFinalEp = issue !== null && maxEp > 0 && issue >= maxEp;

            if (isMaxSeason) {
              if (issue === null && isEnded && action === 'completed') isSeriesComplete = true; 
              else if (issue !== null && hitFinalEp) isSeriesComplete = true; 
            }
            
            if (action === 'completed' && issue === null) {
              isSeasonComplete = true;
            } else if (issue !== null && hitFinalEp && !isSeriesComplete) {
              isSeasonComplete = true; // Auto-complete non-final seasons if final episode is hit
            }
          } else if (issue !== null) {
            const totalEps = apiMatch.number_of_episodes || 0;
            if (totalEps > 0 && issue >= totalEps) isSeriesComplete = true;
          } else if (action === 'completed') {
            isSeriesComplete = true;
          }
        } 
        else if (type === 'anime' || type === 'manga' || type === 'books' || type === 'comics') {
          const maxEp = type === 'anime' ? apiMatch.episodes : (type === 'manga' || type === 'books' ? apiMatch.chapters : (apiMatch.issue_count || apiMatch.issuesCount));
          if (issue !== null && maxEp > 0 && issue >= maxEp) isSeriesComplete = true;
          else if (action === 'completed' && issue === null) isSeriesComplete = true;
        }
        else if (type === 'games' || type === 'vn') {
          if (issue !== null && issue >= 100) isSeriesComplete = true;
          else if (action === 'completed' && issue === null) isSeriesComplete = true;
        }
      } else {
        if (action === 'completed' && issue === null && season === null) isSeriesComplete = true;
        if (action === 'completed' && type === 'tv' && season !== null && issue === null) isSeasonComplete = true;
      }

      const shouldLogToDiary = isSeriesComplete || isSeasonComplete;

      // If the user specified they completed a specific season/issue, but NOT the series, status should be 'in progress'
      if (action === 'completed' && !isSeriesComplete) {
         if (issue !== null || season !== null) {
             safeStatus = 'in progress';
         }
      }

      if (isSeriesComplete) {
        safeStatus = 'completed';
      } else if (issue !== null || season !== null) {
        if (safeStatus === 'completed') safeStatus = 'in progress';
      }

      if (type === 'tv' && season !== null) {
        if (issue !== null) {
          progressStr = `S${String(season).padStart(2, '0')} E${String(issue).padStart(2, '0')}`;
        } else {
          // Season progress fallback
          if (action === 'completed' || isSeasonComplete) {
            const seasonObj = apiMatch?.seasons?.find((s: any) => s.season_number === season);
            const eps = seasonObj?.episode_count || 1;
            progressStr = `S${String(season).padStart(2, '0')} E${String(eps).padStart(2, '0')}`;
          } else if (action === 'in progress' || action === 'planned') {
            progressStr = `S${String(season).padStart(2, '0')} E01`;
          } else {
            progressStr = `S${String(season).padStart(2, '0')} E01`;
          }
        }
      } else if ((type === 'comics' || type === 'manga' || type === 'books') && issue !== null) {
        progressStr = type === 'comics' ? `#${String(issue).padStart(3, '0')}` : `Ch. ${issue}`; 
      } else if (type === 'anime' && issue !== null) {
        progressStr = `Ep. ${issue}`;
      } else if ((type === 'games' || type === 'vn') && issue !== null) {
        progressStr = `${issue}%`;
      } else if (isSeriesComplete) {
        // Auto-complete the entire series/media if no specific episode/issue is provided
        if (type === 'tv') {
          const lastS = apiMatch?.number_of_seasons || 1;
          const lastSObj = apiMatch?.seasons?.find((s: any) => s.season_number === lastS);
          const eps = lastSObj?.episode_count || 1;
          progressStr = `S${String(lastS).padStart(2, '0')} E${String(eps).padStart(2, '0')}`;
        } else if (type === 'anime') {
          const max = apiMatch?.episodes;
          if (max) progressStr = `${max} Episodes`;
        } else if (type === 'manga' || type === 'books') {
          const max = apiMatch?.chapters;
          if (max) progressStr = `${max} Chapters`;
        } else if (type === 'comics') {
          const max = apiMatch?.issue_count || apiMatch?.issuesCount;
          if (max) progressStr = `${max} Issues`;
        } else if (type === 'games' || type === 'vn') {
          progressStr = '100%';
        }
      }

      // Append specific issue to read array if one was parsed
      let updatedReadIssues = (existingMedia?.readIssueIds || []).map(String);
      if (type === 'comics' && specificIssueId !== null) {
        const canonicalIssueId = String(specificIssueId);
        if (!updatedReadIssues.includes(canonicalIssueId)) {
          updatedReadIssues = [...updatedReadIssues, canonicalIssueId];
        }
      }

      let rewatchCount = existingMedia?.rewatchCount || 0;
      if (existingMedia?.status === 'completed' && isSeriesComplete) {
        rewatchCount += 1;
      }

      // Resolve the exact subtype string expected by the frontend UI cards
      let subtype = 'Media';
      if (type === 'tv') subtype = 'TV Shows';
      else if (type === 'movies') subtype = 'Movies';
      else if (type === 'games') subtype = 'Games';
      else if (type === 'comics') subtype = 'Comics';
      else if (type === 'anime') subtype = 'Anime';
      else if (type === 'manga') subtype = 'Manga';
      else if (type === 'books') subtype = 'Books';
      else if (type === 'vn') subtype = 'Visual Novels';

      // Bulletproof string casting before DB insertion to prevent site crashes
      const safeTitle = String(canonicalTitle || 'Unknown');
      const safeSubtype = String(subtype);
      const safeType = String(type);
      const safeImage = posterUrl ? String(posterUrl) : null;
      const safeProgress = progressStr ? String(progressStr) : null;

      const mediaPayload = {
        id: mediaId,
        user_id: userId,
        provider,
        provider_id: providerId,
        media_type: type,
        media_key: mediaKey,
        title: safeTitle,
        type: safeType,
        subtype: safeSubtype,
        image: safeImage,
        rating: rating !== null ? rating : (existingMedia?.rating || 0),
        addedAt: existingMedia?.addedAt || timestampMs,
        dateCompleted: isSeriesComplete ? timestampMs : (safeStatus === 'completed' ? existingMedia?.dateCompleted : null),
        dateStarted: existingMedia?.dateStarted || timestampMs,
        status: safeStatus,
        rewatchCount: rewatchCount,
        ...(safeProgress && { progress: safeProgress }),
        ...(type === 'comics' && { readIssueIds: updatedReadIssues }),
        apiData: { 
          raw: apiMatch || existingMedia?.apiData?.raw || {},
          image: safeImage,
          year: String(canonicalYear || existingMedia?.apiData?.year || ''),
          id: externalId
        }
      };

      let logPayload = null;
      if (shouldLogToDiary) {
        const logId = `telegram:${body.update_id}:${i}`;

        let actionType = 'WATCHED';
        if (type === 'games' || type === 'vn') actionType = 'PLAYED';
        else if (type === 'comics' || type === 'manga' || type === 'books') actionType = 'READ';

        if (existingMedia?.status === 'completed' && isSeriesComplete) {
            actionType = `RE-${actionType}`;
        }
        
        let logSeasonLabel = null;
        if (type === 'tv') {
          if (season !== null) {
            if (isSeasonComplete || isSeriesComplete) logSeasonLabel = `Season ${season}`;
          } else if (isSeriesComplete) {
            const lastS = apiMatch?.number_of_seasons || 1;
            logSeasonLabel = `Season ${lastS}`;
          }
        }

        logPayload = {
          log_id: logId,
          media_id: mediaId,
          user_id: userId,
          provider,
          provider_id: providerId,
          media_type: type,
          media_key: mediaKey,
          action_type: actionType,
          log_date: isoDate,
          season_label: logSeasonLabel,
          season_year: seasonYear ? String(seasonYear) : null,
          image: safeImage,
          review_text: reviewText
        };
      } else {
        console.log(`[Phase 4] Progress update only. Skipped diary log for ${mediaId}`);
      }

      const eventId = `${body.update_id}:${i}`;
      const { data: applied, error: transactionError } = await supabaseAdmin.rpc('apply_telegram_media_event', {
        p_event_id: eventId,
        p_user_id: userId,
        p_media: mediaPayload,
        p_log: logPayload,
      });
      if (transactionError) throw new Error(`Telegram media transaction failed: ${transactionError.code || 'unknown'}`);
      if (!applied) {
        console.log(`Ignored duplicate Telegram event ${eventId}.`);
        continue;
      }

      // --- Phase 5 - Feedback Loop & Deep Linking ---
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      // Invisible link trick to force Telegram to show the high-res poster as a preview
      const safePosterUrl = safeHttpUrl(posterUrl);
      const posterLink = safePosterUrl ? `<a href="${escapeTelegramHtml(safePosterUrl)}">&#8203;</a>` : '';
      const typeLabel = type === 'movies' ? 'Movie' : type === 'tv' ? 'TV' : type === 'comics' ? 'Comic' : type === 'games' ? 'Game' : type === 'anime' ? 'Anime' : type === 'manga' ? 'Manga' : type === 'vn' ? 'VN' : 'Book';
      const escapedTitle = escapeTelegramHtml(safeTitle);
      const escapedProgress = escapeTelegramHtml(safeProgress || '');
      const escapedStatus = escapeTelegramHtml(safeStatus.toUpperCase());
      const escapedType = escapeTelegramHtml(typeLabel);
      const escapedYear = escapeTelegramHtml(canonicalYear || '?');
      const deepLink = `https://project-polyhedron.netlify.app/media/${encodeURIComponent(type)}/${encodeURIComponent(mediaId)}`;
      
      const messageHtml = `
<b>✅ Cataloged Successfully</b>${posterLink}
<b>Title:</b> ${escapedTitle} (${escapedYear})
<b>Type:</b> ${escapedType}
${safeProgress ? `<b>Progress:</b> ${escapedProgress}\n` : ''}<b>Status:</b> ${escapedStatus}
<b>Rating:</b> ${rating ? rating + '/10' : 'None'}
<b>Link:</b> <a href="${deepLink}">View in Polyhedron</a>
      `.trim();

      await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageHtml,
          parse_mode: 'HTML'
        })
      });
    } else {
      // API missing fallback logging
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `❌ Could not find an automatic match for <b>${escapeTelegramHtml(cleanTitle)}</b>`,
          parse_mode: 'HTML'
        })
      });
    }

    // Safe artificial sleep to bypass any 3rd party API (TMDB/IGDB/AniList) rate limits.
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

    // Standard success response for Telegram webhook
    return new Response('Webhook processed successfully', { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Error processing authenticated Telegram webhook.');
    return new Response('Internal Server Error', { status: 200, headers: corsHeaders });
  }
});
