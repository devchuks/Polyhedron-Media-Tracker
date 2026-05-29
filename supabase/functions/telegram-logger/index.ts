// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { corsHeaders } from "../_shared/cors.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0"

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');

  // Telegram webhooks are always POST requests
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();

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
      console.warn(`Unauthorized access attempt from Chat ID: ${chatId}`);
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

    console.log(`Received authorized message at ${timestamp}:\n${text}`);

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
              "Season number or volume number if applicable."
          },

          progressNumber: {
            type: "NUMBER",
            nullable: true,
            description:
              "Episode number, issue number, chapter number, or completion percentage."
          },

          progressUnit: {
            type: "STRING",
            nullable: true,
            enum: [
              "episode",
              "issue",
              "chapter",
              "percentage",
              "season"
            ]
          },

          type: {
            type: "STRING",
            nullable: true,
            enum: [
              "tv",
              "movies",
              "comics",
              "games",
              "anime",
              "manga",
              "vn",
              "books"
            ]
          },

          rawRating: {
            type: "NUMBER",
            nullable: true,
            description:
              "Numeric rating value supplied by the user."
          },

          rawRatingScale: {
            type: "INTEGER",
            nullable: true,
            description:
              "Rating scale denominator such as 5 or 10."
          },

          reviewText: {
            type: "STRING",
            nullable: true,
            description:
              "Freeform review or notes from the user."
          },

          confidence: {
            type: "NUMBER",
            description:
              "Confidence score from 0.0 to 1.0."
          }
        },

        required: [
          "cleanTitle",
          "confidence"
        ]
      }
    }
  })
});

if (!geminiRes.ok) {
  const errorText = await geminiRes.text();

  console.error(
    `[Phase 2] Gemini API Error (${geminiRes.status}):`,
    errorText
  );

  return new Response('Gemini API request failed.', {
    status: 200,
    headers: corsHeaders
  });
}

const geminiData = await geminiRes.json();

const responseText =
  geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

if (!responseText) {
  console.error(
    "[Phase 2] Gemini failed to return structured output:",
    geminiData
  );

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
  console.error(
    "[Phase 2] Structured output parsing failure:",
    responseText
  );

  return new Response('LLM returned invalid structured JSON.', {
    status: 200,
    headers: corsHeaders
  });
}

// Confidence guard
const confidence =
  typeof parsedJson.confidence === 'number'
    ? parsedJson.confidence
    : 0;

if (confidence < 0.35) {
  console.warn(
    `[Phase 2] Low confidence extraction (${confidence})`
  );
}

// Safe Mapping from Structured Output
const cleanTitle =
  typeof parsedJson.cleanTitle === 'string'
    ? parsedJson.cleanTitle.trim()
    : 'Unknown Title';

const year =
  parsedJson.year !== null &&
  parsedJson.year !== undefined
    ? parseInt(parsedJson.year, 10)
    : null;

const season =
  parsedJson.season !== null &&
  parsedJson.season !== undefined
    ? parseInt(parsedJson.season, 10)
    : null;

// Maintain compatibility with existing downstream architecture
const issue =
  parsedJson.progressNumber !== null &&
  parsedJson.progressNumber !== undefined
    ? Math.floor(parsedJson.progressNumber)
    : null;

const progressUnit =
  parsedJson.progressUnit || null;

let type =
  typeof parsedJson.type === 'string'
    ? parsedJson.type.toLowerCase()
    : 'unknown';

const VALID_TYPES = [
  'tv',
  'movies',
  'comics',
  'games',
  'anime',
  'manga',
  'vn',
  'books'
];

if (!VALID_TYPES.includes(type)) {
  type = 'unknown';
}

// Deterministic rating normalization
let rating = null;

if (
  parsedJson.rawRating !== null &&
  parsedJson.rawRating !== undefined
) {
  const rawValue = parseFloat(parsedJson.rawRating);

  const scale =
    parsedJson.rawRatingScale ||
    (rawValue <= 5 ? 5 : 10);

  if (scale === 10) {
    rating = rawValue;
  } else if (scale === 5) {
    rating = rawValue * 2;
  } else {
    rating = rawValue <= 5
      ? rawValue * 2
      : rawValue;
  }

  // Clamp to sane range
  rating = Math.max(0, Math.min(10, rating));
}

let reviewText =
  typeof parsedJson.reviewText === 'string'
    ? parsedJson.reviewText.trim()
    : '';

console.log(
  `[Phase 2 Resolved] ` +
  `Title: ${cleanTitle} | ` +
  `Year: ${year} | ` +
  `Season: ${season} | ` +
  `Progress: ${issue} (${progressUnit}) | ` +
  `Type: ${type} | ` +
  `Rating: ${rating}/10 | ` +
  `Confidence: ${confidence}`
);
    // --- Phase 3 - Autonomous API Resolution ---
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? '';
    
    // Supabase automatically injects SUPABASE_SERVICE_ROLE_KEY into the cloud Edge Function environment.
    // This acts as an admin key to safely bypass Postgres Row-Level Security during backend execution.
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // We'll use the anon key just for invoking your other Edge Functions (Phase 3)
    const anonKey = Deno.env.get('VITE_SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? serviceRoleKey;
    const supabase = createClient(supabaseUrl, anonKey);

    // We'll use the Admin client to explicitly bypass RLS (Phase 4)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

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

      console.log(`[Phase 3] Invoking TMDB for ${cleanTitle}`);
      let { data, error } = await supabase.functions.invoke('tmdb', { body: { path, query: queryParams } });
      
      // Fallback: If TMDB strict year search returns nothing, retry without the year constraint
      if (data?.results?.length === 0 && year) {
        console.log(`[Phase 3] Strict year search failed. Retrying TMDB without year for ${cleanTitle}...`);
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
      console.log(`[Phase 3] Invoking IGDB for ${cleanTitle}`);
      // Fetch up to 10 to allow strict year filtering locally
      const igdbQuery = `search "${cleanTitle}"; fields name,cover.url,first_release_date; limit 10;`;
      const { data, error } = await supabase.functions.invoke('igdb', { body: { endpoint: 'games', query: igdbQuery } });
      
      if (error) console.error('[Phase 3] IGDB Error:', error);
      if (data && data.length > 0) {
        let match = data[0]; // fallback to top match
        if (year) {
          const yearMatch = data.find((g: any) => g.first_release_date && new Date(g.first_release_date * 1000).getFullYear() === year);
          if (yearMatch) match = yearMatch;
        }
        
        externalId = match.id;

        // Deep-fetch full details
        const detailsQuery = `fields *, cover.url, genres.name, platforms.name, release_dates.y; where id = ${externalId};`;
        const { data: fullDetails } = await supabase.functions.invoke('igdb', { body: { endpoint: 'games', query: detailsQuery } });
        apiMatch = (fullDetails && fullDetails.length > 0) ? fullDetails[0] : match;

        canonicalTitle = apiMatch.name;
        if (apiMatch.first_release_date) canonicalYear = new Date(apiMatch.first_release_date * 1000).getFullYear();
        if (apiMatch.cover?.url) {
          posterUrl = apiMatch.cover.url.replace('t_thumb', 't_cover_big');
          if (posterUrl.startsWith('//')) posterUrl = 'https:' + posterUrl;
        }
      }
    } else if (type === 'comics') {
      console.log(`[Phase 3] Invoking Metron for ${cleanTitle}`);
      
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
        console.log(`[Phase 3] Strict year search failed. Retrying Metron without year for ${cleanTitle}...`);
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
      console.log(`[Phase 3] Invoking AniList for ${cleanTitle}`);
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
      console.log(`[Phase 3] Invoking VNDB for ${cleanTitle}`);
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

    console.log(`[Phase 3 Resolved] ID: ${externalId} | Canonical: ${canonicalTitle} (${canonicalYear}) | Season Yr: ${seasonYear} | Episodes: ${episodeCount} | Poster: ${posterUrl}`);

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
      
      const messageDate = new Date(timestamp * 1000);
      const isoDate = messageDate.toISOString();
      const calendarDay = isoDate.split('T')[0];
      const timestampMs = messageDate.getTime();

      // Determine progress strings and milestone states dynamically
      let progressStr = null;

      let isSeriesComplete = issue === null && season === null;
      let isSeasonComplete = type === 'tv' && season !== null && issue === null;

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
              if (issue === null && isEnded) isSeriesComplete = true; 
              else if (issue !== null && hitFinalEp) isSeriesComplete = true; 
            }
            
            if (issue !== null && hitFinalEp && !isSeriesComplete) {
              isSeasonComplete = true; // Auto-complete non-final seasons if final episode is hit
            }
          } else if (issue !== null) {
            const totalEps = apiMatch.number_of_episodes || 0;
            if (totalEps > 0 && issue >= totalEps) isSeriesComplete = true;
          }
        } 
        else if (type === 'anime' || type === 'manga' || type === 'books' || type === 'comics') {
          const maxEp = type === 'anime' ? apiMatch.episodes : (type === 'manga' || type === 'books' ? apiMatch.chapters : (apiMatch.issue_count || apiMatch.issuesCount));
          if (issue !== null && maxEp > 0 && issue >= maxEp) isSeriesComplete = true;
        }
        else if (type === 'games' || type === 'vn') {
          if (issue !== null && issue >= 100) isSeriesComplete = true;
        }
      }

      const shouldLogToDiary = isSeriesComplete || isSeasonComplete;

      if (type === 'tv' && season !== null) {
        if (issue !== null) {
          progressStr = `S${String(season).padStart(2, '0')} E${String(issue).padStart(2, '0')}`;
        } else {
          // Season complete fallback
          const seasonObj = apiMatch?.seasons?.find((s: any) => s.season_number === season);
          const eps = seasonObj?.episode_count || 1;
          progressStr = `S${String(season).padStart(2, '0')} E${String(eps).padStart(2, '0')}`;
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

      // 1. Library Collection Upsert (media_library table)
      const { data: existingMedia } = await supabaseAdmin
        .from('media_library')
        .select('*') // Get everything to preserve existing fields safely
        .eq('id', mediaId)
        .eq('user_id', userId)
        .maybeSingle();

      // Append specific issue to read array if one was parsed
      let updatedReadIssues = existingMedia?.readIssueIds || [];
      if (type === 'comics' && specificIssueId !== null) {
        if (!updatedReadIssues.includes(specificIssueId)) {
          updatedReadIssues = [...updatedReadIssues, specificIssueId];
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
      
      // If logging a new episode/issue for a previously completed series, gracefully downgrade it back to 'in progress'
      let safeStatus = String(existingMedia?.status || 'in progress');
      if (isSeriesComplete) {
        safeStatus = 'completed';
      } else if (issue !== null || season !== null) {
        if (safeStatus === 'completed') safeStatus = 'in progress';
      }

      const mediaPayload = {
        id: mediaId,
        user_id: userId,
        title: safeTitle,
        type: safeType,
        subtype: safeSubtype,
        image: safeImage,
        rating: rating || existingMedia?.rating || 0,
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

      const { error: mediaError } = await supabaseAdmin.from('media_library').upsert(mediaPayload);
      if (mediaError) console.error('[Phase 4] Media Library Upsert Error:', mediaError);

      // 2. Diary Insert (media_logs table) ONLY if it's a completion
      if (shouldLogToDiary) {
        const logId = crypto.randomUUID();

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

        const logPayload = {
          log_id: logId,
          media_id: mediaId,
          user_id: userId,
          media_type: type,
          action_type: actionType,
          log_date: isoDate,
          season_label: logSeasonLabel,
          season_year: seasonYear ? String(seasonYear) : null,
          image: safeImage,
          review_text: reviewText
        };

        const { error: logError } = await supabaseAdmin.from('media_logs').insert(logPayload);
        if (logError) console.error('[Phase 4] Media Logs Upsert Error:', logError);
        else console.log(`[Phase 4] Successfully inserted diary log for ${mediaId}`);
      } else {
        console.log(`[Phase 4] Progress update only. Skipped diary log for ${mediaId}`);
      }

      // --- Phase 5 - Feedback Loop & Deep Linking ---
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      // Invisible link trick to force Telegram to show the high-res poster as a preview
      const posterLink = posterUrl ? `<a href="${posterUrl}">&#8203;</a>` : '';
      const typeLabel = type === 'movies' ? 'Movie' : type === 'tv' ? 'TV' : type === 'comics' ? 'Comic' : type === 'games' ? 'Game' : type === 'anime' ? 'Anime' : type === 'manga' ? 'Manga' : type === 'vn' ? 'VN' : 'Book';
      
      const messageHtml = `
<b>✅ Cataloged Successfully</b>${posterLink}
<b>Title:</b> ${safeTitle} (${canonicalYear || '?'})
<b>Type:</b> ${typeLabel}
${safeProgress ? `<b>Progress:</b> ${safeProgress}\n` : ''}<b>Status:</b> ${safeStatus.toUpperCase()}
<b>Rating:</b> ${rating ? rating + '/10' : 'None'}
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
    }

    // Standard success response for Telegram webhook
    return new Response('Webhook processed successfully', { status: 200, headers: corsHeaders });

  } catch (err) {
    console.error('Error processing webhook:', err);
    return new Response('Internal Server Error', { status: 200, headers: corsHeaders });
  }
});