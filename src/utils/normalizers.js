const TMDB_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music", 
  9648: "Mystery", 10749: "Romance", 878: "Sci-Fi", 10770: "TV Movie", 53: "Thriller", 
  10752: "War", 37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News", 
  10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics"
};

const applyImageProxy = (url, width = 300) => {
  if (!url) return null;
  if (url.includes('vndb.org')) return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&output=webp`;
};

export const normalizeTMDB = (item, type) => {
  const genres = item.genre_ids?.slice(0, 2).map(id => TMDB_GENRES[id]).filter(Boolean).join(' / ');
  const fallback = type === 'tv' ? 'TV Series' : 'Feature Film';

  return {
    id: item.id,
    title: item.title || item.name || "Unknown Title",
    type: type,
    subtype: type === 'tv' ? 'TV Shows' : 'Movies',
    year: item.release_date ? item.release_date.substring(0, 4) : item.first_air_date ? item.first_air_date.substring(0, 4) : "----",
    description: item.overview || "No data available.",
    image: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
    subtitle: genres || fallback,
    score: item.vote_average || 0,
    url: `https://www.themoviedb.org/${type === 'tv' ? 'tv' : 'movie'}/${item.id}`,
    apiSource: 'tmdb',
    raw: item
  };
};

export const normalizeIGDB = (item) => ({
  id: `igdb_${item.id}`,
  title: item.name || "Unknown Title",
  type: 'games',
  subtype: 'Games',
  year: item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear().toString() : "----",
  description: item.summary || item.storyline || "No description available.",
  image: item.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_720p/${item.cover.image_id}.jpg` : null,
  subtitle: item.genres?.length > 0 ? item.genres.map(g => g.name).slice(0, 2).join(' / ') : 'Video Game',
  score: item.total_rating ? Math.round(item.total_rating) : 0,
  url: item.url || `https://www.igdb.com/games/${item.slug}`,
  apiSource: 'igdb',
  raw: item
});

export const normalizeAniList = (item, type) => {
  let dynamicSubtitle = '';
  if (type === 'anime') {
    const studio = item.studios?.nodes?.[0]?.name || 'Unknown Studio';
    dynamicSubtitle = `${studio} • ${item.episodes || '?'} Eps`;
  } else {
    const staffEdges = item.staff?.edges || [];
    const creator = staffEdges.find(e => e.role?.toLowerCase().includes('story') || e.role?.toLowerCase().includes('art'))?.node?.name?.full 
                  || staffEdges[0]?.node?.name?.full || 'Unknown Author';
    dynamicSubtitle = `${creator} • ${item.chapters || '?'} Chps`;
  }

  return {
    id: item.id,
    title: item.title?.english || item.title?.romaji || item.title?.native || "Unknown Title",
    type: type,
    subtype: type === 'anime' ? 'Anime' : 'Manga',
    year: item.startDate?.year ? String(item.startDate.year) : "----",
    description: item.description ? item.description.replace(/<[^>]*>?/gm, '') : "No data available.",
    image: item.coverImage?.extraLarge || item.coverImage?.large || null,
    subtitle: dynamicSubtitle,
    score: item.averageScore || 0,
    url: item.siteUrl || `https://anilist.co/${type.toLowerCase()}/${item.id}`,
    apiSource: 'anilist',
    raw: item
  };
};

export function extractMetronStaff(credits = []) {
  const staff = {};
  for (const c of credits) {
    if (typeof c !== 'object' || c === null) continue;

    let creatorName = 'Unknown';
    let creatorId = c.creator_id || c.id || null;

    if (typeof c.creator === 'string') {
      creatorName = c.creator;
    } else if (c.creator?.name) {
      creatorName = c.creator.name;
      creatorId = c.creator.id || c.id || null;
    }

    let roles = [];
    if (Array.isArray(c.role)) roles = c.role;
    else if (Array.isArray(c.roles)) roles = c.roles;
    else if (c.role) roles = [c.role];

    for (const r of roles) {
      let roleName = 'Unknown';
      if (typeof r === 'string') roleName = r;
      else if (r?.name) roleName = r.name;
      
      if (roleName === 'Unknown') continue;
      
      const mapped = roleName.charAt(0).toUpperCase() + roleName.slice(1);
      if (!staff[mapped]) staff[mapped] = [];
      if (!staff[mapped].some(x => (x.name || x) === creatorName)) staff[mapped].push({ name: creatorName, id: creatorId });
    }
  }
  return staff;
}

export const normalizeMetron = (item) => {
  const isIssueResult = item.hasOwnProperty('cover_date') || item.hasOwnProperty('number');
  const seriesId = isIssueResult ? (item.series?.id || (typeof item.series === 'number' ? item.series : undefined)) : item.id;
  
  // Use issue_[id] routing for individual issues to get precise covers
  const id = isIssueResult ? `issue_${item.id}` : `series_${seriesId || item.id}`;

  let rawTitle = isIssueResult ? (item.series?.name || item.name || "Unknown Comic") : (item.name || item.series || item.sort_name || "Unknown Comic");
  rawTitle = rawTitle.replace(/\s*\(\d{4}\)$/, '');

  const publisherObj = item.publisher || item.raw?.series?.publisher || item.series?.publisher;
  const publisherName = publisherObj?.name || (typeof publisherObj === 'string' ? publisherObj : 'Unknown Publisher');
  const publisherId = publisherObj?.id || null;
  const genres = (item.genres || []).map(g => typeof g === 'object' ? g.name : g).filter(Boolean).slice(0, 8);

  let subtitle = isIssueResult
    ? (item.series?.volume != null ? `Vol. ${item.series.volume}` : 'Comic Series')
    : `${publisherName} • ${item.issue_count || '?'} Issues`;

  if (item.isGroupedSeries) {
    subtitle = `${subtitle.split(' • ')[0]} • ${item.grouped_issue_count} Issue${item.grouped_issue_count > 1 ? 's' : ''}`;
  }

  return {
    id,
    title: rawTitle,
    type: 'comics',
    subtype: 'Comics',
    year: isIssueResult ? (item.cover_date?.substring(0, 4) || "----") : (item.year_began || "----"),
    description: item.desc || item.description || "No description available.",
    image: applyImageProxy(item.image, 500),
    subtitle,
    score: 0,
    url: seriesId ? `https://metron.cloud/series/${seriesId}/` : (item.id ? `https://metron.cloud/issue/${item.id}/` : '#'),
    apiSource: 'metron',
    raw: {
      ...item,
      staff: extractMetronStaff(item.credits || []),
      genres,
      publisherName,
      publisherId,
      issuesCount: isIssueResult ? null : item.issue_count,
    },
  };
};

export const normalizeVNDB = (item) => {
  const engTitleObj = item.titles?.find(t => t.lang === 'en' || t.lang === 'eng');
  const displayTitle = engTitleObj?.latin || engTitleObj?.title || item.title || "Unknown VN";
  return {
    id: item.id,
    title: displayTitle,
    type: 'vn',
    subtype: 'Visual Novels',
    year: item.released ? item.released.substring(0, 4) : "----",
    description: item.description || "No description available.",
    image: applyImageProxy(item.image?.thumbnail || item.image?.url),
    subtitle: item.developers?.[0]?.name || "Unknown Developer",
    score: item.rating ? item.rating / 10 : 0,
    url: `https://vndb.org/${item.id}`,
    apiSource: 'vndb',
    raw: item
  };
};

export const normalizeOpenLibrary = (item) => {
  const firstEdition = item.firstEdition;
  const publisher = firstEdition?.publishers?.[0] || item.publishers?.[0];
  const subjects = item.subjects?.slice(0, 5) || [];

  let authors = [];
  if (item.author_name && Array.isArray(item.author_name)) {
    authors = item.author_name;
  } else if (item.authors && Array.isArray(item.authors)) {
    authors = item.authors.map(a => {
      if (typeof a === 'string') return a;
      if (a?.name) return a.name;
      if (a?.author?.name) return a.author.name;
      return null;
    }).filter(Boolean);
  }

  const subtitle = authors.length > 0
    ? `${authors.slice(0, 2).join(', ')}${authors.length > 2 ? ' et al.' : ''} • ${publisher || 'Unknown Publisher'}`
    : 'Unknown Author';

  return {
    id: item.workId?.replace('/works/', '') || item.key?.replace('/works/', ''),
    title: item.title || "Unknown Book",
    type: 'books',
    subtype: 'Books',
    year: item.first_publish_year ? String(item.first_publish_year) : "----",
    description: item.description?.value || item.description || `First published in ${item.first_publish_year || 'unknown year'}.`,
    image: item.cover_i
      ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : null,
    subtitle,
    score: 0,
    url: `https://openlibrary.org${item.workId || item.key}`,
    apiSource: 'openlibrary',
    raw: {
      ...item,
      publisher,
      subjects,
      authors, 
    },
  };
};

export const processDetailRaw = (rawDetails, type) => {
  if (!rawDetails) return {};

  switch (type) {
    case 'comics': {
      const staff = extractMetronStaff(rawDetails.credits || []);
      const genres = (rawDetails.genres || []).map(g => typeof g === 'object' ? g.name : g).filter(Boolean).slice(0, 8);
      return {
        staff,
        genres,
        publisherName: rawDetails.publisher?.name || rawDetails.publisher || 'Unknown Publisher',
        publisherId: rawDetails.publisher?.id || null,
        issuesCount: rawDetails.issue_count,
      };
    }
    case 'books': {
      const firstEdition = rawDetails.firstEdition;
      const publisher = firstEdition?.publishers?.[0] || rawDetails.publishers?.[0];
      const subjects = rawDetails.subjects?.slice(0, 5) || [];

      let amazon, goodreads, librarything, isbn;
      const links = [];
      
      if (rawDetails.links && Array.isArray(rawDetails.links)) {
        links.push(...rawDetails.links);
      }

      const editions = rawDetails.editions || [];
      for (const ed of editions) {
        if (!amazon && ed.identifiers?.amazon) amazon = ed.identifiers.amazon[0];
        if (!goodreads && ed.identifiers?.goodreads) goodreads = ed.identifiers.goodreads[0];
        if (!librarything && ed.identifiers?.librarything) librarything = ed.identifiers.librarything[0];
        if (!isbn && (ed.isbn_13 || ed.isbn_10)) isbn = ed.isbn_13?.[0] || ed.isbn_10?.[0];
        
        if (ed.links && Array.isArray(ed.links)) {
          links.push(...ed.links);
        }
        if (ed.ocaid) {
          links.push({ title: 'Read on Archive.org', url: `https://archive.org/details/${ed.ocaid}` });
        }
      }

      const uniqueLinks = Array.from(new Map(links.map(l => [l.url, l])).values());

      let validAuthors;
      if (rawDetails.authors && Array.isArray(rawDetails.authors)) {
        const extracted = rawDetails.authors.map(a => {
          if (typeof a === 'string') return a;
          if (a?.author?.name) return a.author.name;
          if (a?.name) return a.name;
          return null;
        }).filter(Boolean);
        if (extracted.length > 0) validAuthors = extracted;
      }

      const res = {
        publisher,
        subjects,
        amazon,
        goodreads,
        librarything,
        isbn,
        links: uniqueLinks
      };

      if (validAuthors) res.authors = validAuthors;
      
      delete rawDetails.authors;
      delete rawDetails.author_name;

      return res;
    }
    default:
      return {};
  }
};
