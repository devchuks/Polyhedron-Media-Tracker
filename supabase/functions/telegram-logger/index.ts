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
    const text = message.text || '';
    const timestamp = message.date; // Unix timestamp provided by Telegram

    if (!text) {
      return new Response('No text provided.', { status: 200, headers: corsHeaders });
    }

    console.log(`Received authorized message at ${timestamp}:\n${text}`);

    // --- Phase 2 - Regex Parsing Engine ---
    
    // Split the raw message text by line breaks
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

    if (lines.length < 4) {
      return new Response('Webhook acknowledged, but message format does not match required 4-line template.', { status: 200, headers: corsHeaders });
    }

    // Line 1: Title, Year, and Season
    const line1 = lines[0];
    
    const yearMatch = line1.match(/\((\d{4})\)/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
    
    const seasonMatch = line1.match(/s(?:eason\s*)?(\d+)/i);
    const season = seasonMatch ? parseInt(seasonMatch[1], 10) : null;

    const issueMatch = line1.match(/#(\d+)|issue\s*(\d+)|ep(?:isode)?\s*(\d+)|ch(?:apter)?\s*(\d+)/i);
    const issue = issueMatch ? parseInt(issueMatch[1] || issueMatch[2] || issueMatch[3] || issueMatch[4], 10) : null;

    const cleanTitle = line1
      .replace(/\(\d{4}\)/g, '')            // Strip year
      .replace(/s(?:eason\s*)?\d+/ig, '')   // Strip season
      .replace(/#\d+|issue\s*\d+|ep(?:isode)?\s*\d+|ch(?:apter)?\s*\d+/ig, '') // Strip issue/ep/ch
      .replace(/\s+/g, ' ')                 // Remove any duplicate whitespace left behind
      .trim();

    // Line 2: Media Type Normalization
    const rawType = lines[1].toLowerCase();
    let type = 'unknown';
    if (rawType.includes('tv') || rawType.includes('show')) type = 'tv';
    else if (rawType.includes('movie') || rawType.includes('film')) type = 'movies';
    else if (rawType.includes('comic')) type = 'comics';
    else if (rawType.includes('game')) type = 'games';
    else if (rawType.includes('anime')) type = 'anime';
    else if (rawType.includes('manga')) type = 'manga';
    else if (rawType.includes('vn') || rawType.includes('visual novel')) type = 'vn';

    // Deep Scan: Rating Conversion (Supports x/10, x/5, x stars, or raw numbers anywhere)
    let rating = null;
    let parsedRatingLine = 'None found';
    for (const line of lines.slice(1)) {
      const explicitMatch = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:\/\s*(10|5)|stars?)/i);
      if (explicitMatch) {
        const val = parseFloat(explicitMatch[1]);
        const scale = explicitMatch[2];
        if (scale === '10') rating = val;
        else if (scale === '5' || line.toLowerCase().includes('star')) rating = val * 2;
        else rating = val <= 5 ? val * 2 : val;
        parsedRatingLine = line;
        break;
      }
    }
    // Fallback: Check for standalone numbers on the third line specifically
    if (rating === null && lines[2]) {
      const standaloneMatch = lines[2].match(/^(\d+(?:\.\d+)?)$/);
      if (standaloneMatch) {
        const val = parseFloat(standaloneMatch[1]);
        rating = val <= 5 ? val * 2 : val;
        parsedRatingLine = lines[2];
      }
    }

    // Line 4+: Review Capture
    const reviewText = lines.slice(3).join('\n');

    console.log(`Parsed -> Title: ${cleanTitle} | Year: ${year} | Season: ${season} | Type: ${type} | Rating: ${rating}/10`);

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
        if (type === 'tv') queryParams.first_air_date_year = year;
        else queryParams.year = year;
      }

      console.log(`[Phase 3] Invoking TMDB for ${cleanTitle}`);
      const { data, error } = await supabase.functions.invoke('tmdb', { body: { path, query: queryParams } });
      
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

      const { data, error } = await supabase.functions.invoke('metron', { body: { path: `/api/issue/?${issueParams.toString()}` } });
      
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

      // Determine progress strings and diary log labels dynamically
      let progressStr = null;
      let logLabel = null;
      if (type === 'tv' && season !== null) {
        progressStr = `S${String(season).padStart(2, '0')}`;
        logLabel = `Season ${season}`;
      } else if ((type === 'comics' || type === 'manga' || type === 'books') && issue !== null) {
        progressStr = type === 'comics' ? `#${String(issue).padStart(3, '0')}` : `Ch. ${issue}`; 
        logLabel = type === 'comics' ? `Issue ${issue}` : `Chapter ${issue}`;
      } else if (type === 'anime' && issue !== null) {
        progressStr = `Ep. ${issue}`;
        logLabel = `Episode ${issue}`;
      } else if (issue === null && season === null) {
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
      const safeStatus = (issue === null && season === null) ? 'completed' : String(existingMedia?.status || 'completed');

      const mediaPayload = {
        id: mediaId,
        user_id: userId,
        title: safeTitle,
        type: safeType,
        subtype: safeSubtype,
        image: safeImage,
        rating: rating || existingMedia?.rating || 0,
        addedAt: existingMedia?.addedAt || timestampMs,
        dateCompleted: timestampMs,
        dateStarted: existingMedia?.dateStarted || timestampMs,
        status: safeStatus,
        ...(safeProgress && { progress: safeProgress }),
        ...(type === 'comics' && { readIssueIds: updatedReadIssues }),
        apiData: { 
          raw: apiMatch || existingMedia?.apiData?.raw || {},
          image: safeImage,
          year: String(canonicalYear || existingMedia?.apiData?.year || '') 
        }
      };

      const { error: mediaError } = await supabaseAdmin.from('media_library').upsert(mediaPayload);
      if (mediaError) console.error('[Phase 4] Media Library Upsert Error:', mediaError);

      // 2. Diary Insert (media_logs table) - Use UUID to perfectly match the frontend behavior
      const logId = crypto.randomUUID();

      let actionType = 'WATCHED';
      if (type === 'games' || type === 'vn') actionType = 'PLAYED';
      else if (type === 'comics' || type === 'manga' || type === 'books') actionType = 'READ';

      const logPayload = {
        log_id: logId,
        media_id: mediaId,
        user_id: userId,
        media_type: type,
        action_type: actionType,
        log_date: isoDate,
        season_label: logLabel,
        season_year: seasonYear ? String(seasonYear) : null,
        image: safeImage,
        review_text: reviewText
      };

      const { error: logError } = await supabaseAdmin.from('media_logs').insert(logPayload);
      if (logError) console.error('[Phase 4] Media Logs Upsert Error:', logError);
      else console.log(`[Phase 4] Successfully upserted ${mediaId} into database!`);

      // --- Phase 5 - Feedback Loop & Deep Linking ---
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      // Invisible link trick to force Telegram to show the high-res poster as a preview
      const posterLink = posterUrl ? `<a href="${posterUrl}">&#8203;</a>` : '';
      const typeLabel = type === 'movies' ? 'Movie' : type === 'tv' ? 'TV' : type === 'comics' ? 'Comic' : type === 'games' ? 'Game' : type === 'anime' ? 'Anime' : type === 'manga' ? 'Manga' : type === 'vn' ? 'VN' : 'Book';
      
      const messageHtml = `
<b>✅ Cataloged Successfully</b>${posterLink}
<b>Title:</b> ${safeTitle} (${canonicalYear || '?'})
<b>Type:</b> ${typeLabel}
${safeProgress ? `<b>Progress:</b> ${safeProgress}\n` : ''}<b>Rating:</b> ${rating ? rating + '/10' : 'None'}
<pre>
--- DEBUG INFO ---
Rating Scanned: ${rating} (from: "${parsedRatingLine}")
Extracted ID: ${externalId}
Image Saved: ${safeImage ? 'Yes' : 'No'}
</pre>
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