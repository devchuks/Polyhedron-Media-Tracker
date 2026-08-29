# Polyhedron

Polyhedron is a universal media tracker for movies, TV shows, anime, manga, books, visual novels, games, and comics. It combines a personal library, discovery tools, detailed metadata, and a chronological activity diary in one responsive application.

[Live application](https://project-polyhedron.netlify.app/) · [GitHub repository](https://github.com/devchuks/polyhedron-media-tracker)

![Polyhedron dashboard with in-progress media, recent additions, and diary activity](assets/readme/dashboard.png)

## Highlights

- Track status, ratings, progress, dates, reviews, rewatches, rereads, TV seasons, and individual comic issues.
- Search multiple media providers and explore trending titles, upcoming releases, creators, studios, publishers, and related works.
- Keep library state and diary history distinct, with stable activity identities and precise season-level TV logging.
- Use a curated, IndexedDB-backed Guest Mode or an authenticated cloud library with realtime synchronization and owner-scoped security.
- Export and restore libraries, including supported legacy backups, and log supported activity through Telegram.

## Discovery and search

Discovery brings trending, upcoming, and popular media together across categories.

![Polyhedron Discovery page showing trending and upcoming movies](assets/readme/discovery.png)

Global search supports every media category, paginated results, and quick-add actions.

![Polyhedron movie search results for Avengers titles](assets/readme/search.png)

## Details and exploration

Detail pages combine artwork, descriptions, scores, genres, releases, people and companies, galleries, external links, recommendations, and category-specific metadata.

![Polyhedron game detail page with artwork, platforms, gallery, and external links](assets/readme/game-details.png)

Explore pages connect media to creators, cast, studios, publishers, developers, genres, and filmographies.

![Polyhedron creator exploration page showing Daniel Craig and a filmography](assets/readme/creator-explore.png)

## Diary

The Diary groups explicit activities by date. Stable entry identities allow separate same-day activities to coexist and be edited independently.

![Polyhedron Diary with dated movie, TV-season, and anime entries](assets/readme/diary.png)

## Media providers

| Category | Provider |
|---|---|
| Movies and TV | TMDB |
| Anime and manga | AniList |
| Games | IGDB |
| Books | Open Library |
| Visual novels | VNDB |
| Comics and issues | Metron |

## Tech stack

- React 19, React Router, Vite
- Tailwind CSS 4 and DaisyUI
- Zustand state management
- IndexedDB guest persistence
- Supabase Auth, PostgreSQL, Realtime, Edge Functions, and row-level security
- Netlify hosting
