// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0"
import { assertGraphqlSuccess, enforceRateLimit, escapeTelegramHtml, readBoundedJson, safeHttpUrl, verifyTelegramWebhookSecret } from "../_shared/validation.js"
import {
  buildTelegramLifecycle,
  classifyTelegramIntent,
  progressForTelegramIntent,
  providerForMediaType,
  selectDeterministicProviderMatch,
  telegramConfirmation,
} from "../_shared/telegramSemantics.js"

const fetchProvider = (url: string, init: RequestInit = {}) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(15_000),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');

  // Telegram webhooks are always POST requests
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    enforceRateLimit(req, { keyPrefix: 'telegram', limit: 30 });
  } catch (error) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': String(error.retryAfterSeconds || 60) },
    });
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

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('VITE_SUPABASE_ANON_KEY') ?? '';
const userId = Deno.env.get('ADMIN_USER_ID');

if (!supabaseUrl || !serviceRoleKey || !anonKey || !userId) {
  console.error('Supabase logger configuration is incomplete.');
  return new Response('Configuration Error', { status: 500, headers: corsHeaders });
}

const supabase = createClient(supabaseUrl, anonKey);
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
const { data: existingBatch, error: existingBatchError } = await supabaseAdmin
  .from('webhook_batches')
  .select('plan')
  .eq('source', 'telegram')
  .eq('event_id', String(body.update_id))
  .eq('user_id', userId)
  .maybeSingle();
if (existingBatchError) {
  console.error('Unable to inspect Telegram batch idempotency state.');
  return new Response('Idempotency check failed', { status: 500, headers: corsHeaders });
}
let items = Array.isArray(existingBatch?.plan) ? existingBatch.plan : null;
const isNewBatch = !items;

if (isNewBatch) {

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
- Classify intent explicitly. "started" is START, an episode/chapter/percentage update is UPDATE_PROGRESS,
  "watched/read/played/finished" is COMPLETE_ITEM unless a season is explicitly named, and a named
  finished season is COMPLETE_SEASON. Rewatch/reread/replay must use the corresponding REWATCH intent.
- A rating by itself is RATE and never implies completion.
- Do not invent a date. The webhook message timestamp is the activity timestamp.
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
                intent: {
                  type: "STRING",
                  nullable: true,
                  enum: ["ADD_PLANNED", "START", "UPDATE_PROGRESS", "COMPLETE_ITEM", "COMPLETE_SEASON", "REWATCH_ITEM", "REWATCH_SEASON", "RATE", "NOTE"],
                  description: "The explicit semantic user intent. Rating-only input must be RATE."
                },
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
                providerId: {
                  type: "STRING",
                  nullable: true,
                  description: "An explicit provider identifier only when the user supplied one."
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
    status: 502,
    headers: corsHeaders
  });
}

const geminiData = await geminiRes.json();

const responseText =
  geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

if (!responseText) {
  console.error("[Phase 2] Gemini failed to return structured output.");

  return new Response('Failed to parse message with LLM.', {
    status: 502,
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
    status: 502,
    headers: corsHeaders
  });
}

items = parsedJson.items;
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
}

if (isNewBatch && items.length > 1) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `⏳ Processing a batch of ${items.length} items...`
    })
  });
}

const { data: stablePlan, error: planError } = await supabaseAdmin.rpc('prepare_telegram_batch', {
  p_event_id: String(body.update_id),
  p_user_id: userId,
  p_plan: items,
});
if (planError || !Array.isArray(stablePlan)) {
  console.error('Unable to persist the Telegram batch plan.');
  return new Response('Batch preparation failed', { status: 500, headers: corsHeaders });
}
items = stablePlan;

const eventIds = items.map((_, itemIndex) => `${body.update_id}:${itemIndex}`);
const { data: completedEvents, error: completedEventsError } = await supabaseAdmin
  .from('webhook_events')
  .select('event_id')
  .eq('source', 'telegram')
  .eq('user_id', userId)
  .in('event_id', eventIds);
if (completedEventsError) {
  console.error('Unable to inspect Telegram event idempotency state.');
  return new Response('Idempotency check failed', { status: 500, headers: corsHeaders });
}
const completedEventIds = new Set((completedEvents || []).map((event: any) => event.event_id));

// BATCH PROCESSING LOOP
let failedItems = 0;
for (let i = 0; i < items.length; i++) {
  try {
  const item = items[i];
  const eventId = `${body.update_id}:${i}`;
  if (completedEventIds.has(eventId)) {
    console.log(`Ignored duplicate Telegram event ${eventId} before provider resolution.`);
    continue;
  }

  // Confidence guard
  const confidence = typeof item.confidence === 'number' ? item.confidence : 0;
  if (confidence < 0.35) {
    console.warn(`[Phase 2] Low confidence extraction (${confidence}) on item ${i+1}`);
  }

  // Safe Mapping from Structured Output
  const intent = classifyTelegramIntent(item);
  const cleanTitle = typeof item.cleanTitle === 'string' ? item.cleanTitle.trim() : 'Unknown Title';
  const year = item.year !== null && item.year !== undefined ? parseInt(item.year, 10) : null;
  const explicitProviderId = item.providerId !== null && item.providerId !== undefined ? String(item.providerId).trim() : null;
  const season = item.season !== null && item.season !== undefined ? parseInt(item.season, 10) : null;
  const issue = item.progressNumber !== null && item.progressNumber !== undefined ? Math.floor(item.progressNumber) : null;

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

  console.log(`[Phase 2 Resolved] Item ${i+1}/${items.length} | Intent: ${intent} | Type: ${type} | Confidence: ${confidence}`);

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
    let ambiguityOptions: any[] = [];

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
      
      if (error) throw new Error('TMDB lookup failed');
      if (data?.results?.length > 0) {
        const resolution = selectDeterministicProviderMatch(data.results.map((candidate: any) => ({
          id: candidate.id,
          title: candidate.name || candidate.title,
          year: parseInt((candidate.first_air_date || candidate.release_date || '').split('-')[0], 10) || null,
          raw: candidate,
        })), cleanTitle, year, explicitProviderId);
        ambiguityOptions = resolution.options;
        const match = resolution.match?.raw;
        if (!match) {
          externalId = null;
        } else {
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
      }
    } else if (type === 'games') {
      console.log('[Phase 3] Invoking IGDB.');
      const { data, error } = await supabase.functions.invoke('igdb', {
        body: { operation: 'searchGames', params: { query: cleanTitle, page: 1 } },
      });
      
      if (error) throw new Error('IGDB lookup failed');
      if (data && data.length > 0) {
        const resolution = selectDeterministicProviderMatch(data.map((candidate: any) => ({
          id: candidate.id,
          title: candidate.name,
          year: candidate.first_release_date ? new Date(candidate.first_release_date * 1000).getFullYear() : null,
          raw: candidate,
        })), cleanTitle, year, explicitProviderId);
        ambiguityOptions = resolution.options;
        const match = resolution.match?.raw;
        if (!match) externalId = null;
        else {
        
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
      
      if (error) throw new Error('Metron lookup failed');
      if (data?.results?.length > 0) {
        const resolution = selectDeterministicProviderMatch(data.results.map((candidate: any) => ({
          id: candidate.series?.id ?? candidate.id,
          title: candidate.series?.name ?? candidate.series ?? cleanTitle,
          year: candidate.cover_date ? parseInt(candidate.cover_date.substring(0, 4), 10) : null,
          raw: candidate,
        })), cleanTitle, year, explicitProviderId);
        ambiguityOptions = resolution.options;
        const match = resolution.match?.raw;
        if (match) {
        
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
        const res = await fetchProvider('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query, variables: { search: cleanTitle } })
        });
        if (!res.ok) throw new Error(`AniList lookup failed (${res.status})`);
        const json = assertGraphqlSuccess(await res.json(), 'AniList');
        
        if (json.data?.Page?.media?.length > 0) {
          const results = json.data.Page.media;
          const resolution = selectDeterministicProviderMatch(results.map((candidate: any) => ({
            id: candidate.id,
            title: candidate.title?.english || candidate.title?.romaji,
            year: candidate.startDate?.year || null,
            raw: candidate,
          })), cleanTitle, year, explicitProviderId);
          ambiguityOptions = resolution.options;
          const match = resolution.match?.raw;
          if (!match) externalId = null;
          else {
          externalId = match.id;
          apiMatch = match;
          canonicalTitle = match.title?.english || match.title?.romaji || cleanTitle;
          canonicalYear = match.startDate?.year || year;
          posterUrl = match.coverImage?.extraLarge || match.coverImage?.large || null;
          }
        }
      } catch (error) {
        throw new Error('AniList lookup failed');
      }
    } else if (type === 'vn') {
      console.log('[Phase 3] Invoking VNDB.');
      try {
        const res = await fetchProvider('https://api.vndb.org/kana/vn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: ['search', '=', cleanTitle],
            fields: 'id, title, titles.lang, titles.title, titles.latin, released, image.url, image.thumbnail, developers.name, description, length, tags.name, relations.relation, relations.id, relations.title, relations.image.url, screenshots.url, extlinks.url, extlinks.label',
            results: 10
          })
        });
        if (!res.ok) throw new Error(`VNDB lookup failed (${res.status})`);
        const json = await res.json();
        
        if (json.results?.length > 0) {
          const results = json.results;
          const resolution = selectDeterministicProviderMatch(results.map((candidate: any) => ({
            id: candidate.id,
            title: candidate.title,
            year: candidate.released ? parseInt(candidate.released.split('-')[0], 10) : null,
            raw: candidate,
          })), cleanTitle, year, explicitProviderId);
          ambiguityOptions = resolution.options;
          const match = resolution.match?.raw;
          if (!match) externalId = null;
          else {
          externalId = match.id;
          apiMatch = match;
          const engTitleObj = match.titles?.find((t: any) => t.lang === 'en' || t.lang === 'eng');
          canonicalTitle = engTitleObj?.latin || engTitleObj?.title || match.title || cleanTitle;
          if (match.released) canonicalYear = parseInt(match.released.split('-')[0], 10) || year;
          // Force strict string casting to prevent corrupted object payloads
          posterUrl = match.image?.url ? String(match.image.url) : (typeof match.image === 'string' ? match.image : null);
          }
        }
      } catch (error) {
        throw new Error('VNDB lookup failed');
      }
    } else if (type === 'books') {
      console.log('[Phase 3] Invoking OpenLibrary.');
      const url = new URL('https://openlibrary.org/search.json');
      url.searchParams.set('title', cleanTitle);
      url.searchParams.set('limit', '10');
      const res = await fetchProvider(url.toString(), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`OpenLibrary lookup failed (${res.status})`);
      const json = await res.json();
      const results = Array.isArray(json.docs) ? json.docs : [];
      if (results.length > 0) {
        const resolution = selectDeterministicProviderMatch(results.map((candidate: any) => ({
          id: String(candidate.key || '').replace(/^\/works\//, ''),
          title: candidate.title,
          year: candidate.first_publish_year || null,
          raw: candidate,
        })), cleanTitle, year, explicitProviderId);
        ambiguityOptions = resolution.options;
        const match = resolution.match?.raw;
        if (match) {
        const workKey = String(match.key || '').replace(/^\/works\//, '');
        if (workKey) {
          externalId = workKey;
          apiMatch = match;
          canonicalTitle = match.title || cleanTitle;
          canonicalYear = match.first_publish_year || year;
          posterUrl = match.cover_i ? `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg` : null;
        }
        }
      }
    }

    console.log(`[Phase 3 Resolved] Provider match: ${externalId ? 'yes' : 'no'}.`);

    if (!externalId && ambiguityOptions.length > 0) {
      const optionText = ambiguityOptions.slice(0, 5)
        .map((option: any) => `• ${escapeTelegramHtml(option.title)}${option.year ? ` (${escapeTelegramHtml(option.year)})` : ''}`)
        .join('\n');
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `<b>Choose a more specific title/year:</b>\n${optionText}`,
          parse_mode: 'HTML',
        }),
      });
      continue;
    }

    // --- Phase 4 - Database Execution and Upsert Logic ---

    const userId = Deno.env.get('ADMIN_USER_ID');
    if (!userId) {
      console.error('[Phase 4] CRITICAL ERROR: ADMIN_USER_ID is missing from environment variables.');
      return new Response('Configuration Error', { status: 500, headers: corsHeaders });
    }

    if (externalId) {
      // Match the exact ID formatting expected by your frontend
      let mediaId = String(externalId);
      if (type === 'comics') mediaId = isComicSeries ? `series_${externalId}` : `issue_${externalId}`;
      else if (type === 'games') mediaId = `igdb_${externalId}`;
      const provider = providerForMediaType(type);
      if (!provider) throw new Error('Unsupported canonical provider mapping');
      const providerId = type === 'comics' ? mediaId : String(externalId);
      const mediaKey = `${provider}:${type}:${providerId}`;
      
      // Advance timestamp minimally to guarantee chronological ordering in the UI 
      const timestampMs = new Date(timestamp * 1000).getTime() + i;
      const isoDate = new Date(timestampMs).toISOString();

      // Read the current owner-scoped state so the same explicit-intent lifecycle
      // contract used by the browser can preserve user-controlled fields.
      const { data: existingMedia, error: existingMediaError } = await supabaseAdmin
        .from('media_library')
        .select('*') // Get everything to preserve existing fields safely
        .eq('media_key', mediaKey)
        .eq('user_id', userId)
        .maybeSingle();
      if (existingMediaError) throw new Error('Existing media lookup failed');

      // Append specific issue to read array if one was parsed
      let updatedReadIssues = (existingMedia?.readIssueIds || []).map(String);
      if (type === 'comics' && specificIssueId !== null) {
        const canonicalIssueId = String(specificIssueId);
        if (!updatedReadIssues.includes(canonicalIssueId)) {
          updatedReadIssues = [...updatedReadIssues, canonicalIssueId];
        }
      }

      const authoritativeTotal = type === 'anime'
        ? apiMatch?.episodes
        : type === 'manga' || type === 'books'
          ? apiMatch?.chapters
          : type === 'comics'
            ? (apiMatch?.issue_count || apiMatch?.issuesCount)
            : null;
      const semanticProgress = progressForTelegramIntent({
        type,
        intent,
        season,
        progressNumber: issue,
        episodeCount,
        total: authoritativeTotal,
      });
      const progressStr = semanticProgress ?? existingMedia?.progress ?? null;
      const lifecycle = buildTelegramLifecycle({
        existing: existingMedia,
        intent,
        type,
        activityAt: timestampMs,
        rating,
        progress: progressStr,
        season,
        seasonYear,
      });
      const safeStatus = lifecycle.status;
      const shouldLogToDiary = lifecycle.shouldLog;

      const rewatchCount = lifecycle.rewatchCount;

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
        rating: lifecycle.rating,
        addedAt: lifecycle.addedAt,
        dateCompleted: lifecycle.dateCompleted,
        dateStarted: lifecycle.dateStarted,
        status: safeStatus,
        rewatchCount: rewatchCount,
        ...(safeProgress && { progress: safeProgress }),
        ...(type === 'comics' && { readIssueIds: updatedReadIssues }),
        updated_at: isoDate,
        _mutation: {
          rewatch_increment: lifecycle.rewatchIncrement,
          add_read_issue: type === 'comics' && specificIssueId !== null ? String(specificIssueId) : null,
        },
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

        logPayload = {
          log_id: logId,
          media_id: mediaId,
          user_id: userId,
          provider,
          provider_id: providerId,
          media_type: type,
          media_key: mediaKey,
          action_type: lifecycle.actionType,
          log_date: isoDate,
          season_label: lifecycle.seasonLabel,
          season_year: lifecycle.seasonYear,
          image: safeImage,
          review_text: reviewText
        };
      } else {
        console.log(`[Phase 4] Progress update only. Skipped diary log for ${mediaId}`);
      }

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
      const escapedType = escapeTelegramHtml(typeLabel);
      const escapedYear = escapeTelegramHtml(canonicalYear || '?');
      const deepLink = `https://project-polyhedron.netlify.app/media/${encodeURIComponent(type)}/${encodeURIComponent(mediaId)}`;
      const confirmation = telegramConfirmation({ title: safeTitle, intent, lifecycle, activityAt: timestampMs });
      const messageHtml = `
<b>✅ ${escapeTelegramHtml(confirmation.headline)}</b>${posterLink}
<b>Title:</b> ${escapedTitle} (${escapedYear})
<b>Type:</b> ${escapedType}
${confirmation.lines.map((line: string) => `<b>${escapeTelegramHtml(line)}</b>`).join('\n')}
<b>Status:</b> ${escapeTelegramHtml(safeStatus.toUpperCase())}
<b>Rating:</b> ${lifecycle.rating ? lifecycle.rating + '/10' : 'None'}
<b>Link:</b> <a href="${deepLink}">View in Polyhedron</a>
      `.trim();

      try {
        const feedbackResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: messageHtml, parse_mode: 'HTML' })
        });
        if (!feedbackResponse.ok) console.warn(`Telegram feedback failed with status ${feedbackResponse.status}.`);
      } catch {
        console.warn('Telegram feedback delivery failed after a successful database commit.');
      }
    } else {
      // API missing fallback logging
      try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `❌ Could not find an automatic match for <b>${escapeTelegramHtml(cleanTitle)}</b>`,
            parse_mode: 'HTML'
          })
        });
      } catch {
        console.warn('Telegram no-match feedback delivery failed.');
      }
    }

    // Safe artificial sleep to bypass any 3rd party API (TMDB/IGDB/AniList) rate limits.
    if (i < items.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (itemError) {
    failedItems += 1;
    console.error(`Telegram item ${i + 1} failed and remains retryable.`);
  }
  }

    if (failedItems > 0) {
      return new Response('One or more items remain retryable', { status: 500, headers: corsHeaders });
    }
    return new Response('Webhook processed successfully', { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Error processing authenticated Telegram webhook.');
    return new Response('Internal Server Error', { status: 500, headers: corsHeaders });
  }
});
