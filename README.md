# Table Tennis Tracker

A lightweight, mobile-first web app for tracking ranked table tennis matches within a single office environment.

The app focuses on **simplicity, correctness, transparency, and zero-cost hosting**, while remaining flexible enough to support Elo ratings, detailed statistics, and future tournament modes.

---

## Purpose

Table Tennis Tracker is designed to:

- Record completed, ranked table tennis matches
- Maintain a complete and auditable match record log
- Compute Elo ratings and player statistics deterministically
- Provide clear leaderboards and player profiles
- Support low-friction match submission and correction

The app is intended for **trusted users** in a small, internal league (e.g. an office).

---

## Core Features

- Ranked match tracking (best-of formats)
- Game-level score recording
- Client-side Elo computation
- Leaderboards with filtering
- Player profiles and match records
- Detailed personal statistics dashboard
- View-only inspection of other players’ stats
- Soft-delete and audit logging for corrections

---

## Tech Stack

### Frontend
- Vue 3
- TypeScript
- Vite
- Mobile-first web app
- Hosted on GitHub Pages

### Backend / Data
- Supabase
  - PostgreSQL (free tier)
  - Supabase Auth (email + password, email confirmation disabled)
  - Profiles are created on signup via a DB trigger (using auth metadata)
- No custom backend services
- Frontend communicates directly with Supabase via SDK

---

## Design Principles

- Matches are the source of truth
- All stats and Elo are derived from match records
- No pre-aggregated statistics or stored ratings
- Prefer recomputation over storage
- Prefer correction over deletion
- Minimal security assumptions (trusted users)
- No premature optimization

---

## Intended Use Case

- Single office or small internal league
- No public access
- No real-time scoring
- No offline support
- No large-scale performance requirements

---

## Status

This project is an internal tool and is intentionally scoped to remain simple, transparent, and maintainable.

Future features (such as tournaments or advanced analytics) are additive and not required for core functionality.
