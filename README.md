# `Project Polyhedron` - Universal Media Tracking Dashboard

**Live Demo:** Project Polyhedron

Polyhedron is a unified, multi-faceted media tracking dashboard. It allows users to search, log, and track their progress across a massive variety of entertainment mediums in a single interface. 

Originally a Vanilla JS prototype, Polyhedron is now a robust, full-stack React application backed by Supabase.

## 🚀 Features
*   **Universal Search & Aggregation:** Pulls live data from multiple external databases to log Visual Novels, Comics, Games, Anime, Manga, Movies, Books, and TV Shows.
*   **Dynamic UI Toggles:** Seamless switching between Grid and List views for user-customized browsing.
*   **Progress Tracking:** Users can update their consumption status (Planned, In Progress, Completed, Dropped) and assign 1-10 ratings with visual star indicators.
*   **Diary View:** A chronological timeline of completed media entries.
*   **Cloud Sync & Local Storage:** "Admin" users securely sync their libraries to a Supabase PostgreSQL database in real-time, while "Guest" mode safely persists collections locally via IndexedDB.

## 🔌 Integrated APIs (via Supabase Edge Functions)
To securely manage API keys and bypass browser CORS limitations, all external requests are proxied through secure Deno Edge Functions:
*   **TMDB API:** Movies and TV Shows.
*   **IGDB API (Twitch):** Video Games.
*   **AniList API (GraphQL):** Anime and Manga.
*   **VNDB API:** Visual Novels.
*   **OpenLibrary API:** Books.
*   **Metron API:** Comic book volumes and issues.

## 🏗️ Architecture & Security
*   **Frontend:** React, Vite, TailwindCSS, DaisyUI, Zustand (State Management).
*   **Backend:** Supabase PostgreSQL, Supabase Auth.
*   **Serverless:** Deno Edge Functions proxy external APIs securely.
*   **Security:** Row Level Security (RLS) ensures user data is completely isolated. JWT tokens handle secure session management.
