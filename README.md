# Table Tennis Tracker

A lightweight, mobile-first web app for tracking ranked table tennis matches in a single office or small league.

This README is written for someone who wants to use the app or quickly understand what it does.

---

## What this app is for

- Record completed matches between two players
- Keep a clean, auditable history of results
- Show a leaderboard and player profiles
- Compute Elo ratings and stats consistently
- Allow quick corrections without deleting history

The app assumes a small, trusted group of users and favors clarity over heavy security or complex workflows.

---

## What you can do

- Submit a match (best-of formats) with per-game scores
- See a leaderboard of active players
- Open a player profile to view match history and stats
- View your own stats dashboard
- Edit a match you participated in
- Admins can create, edit, or void any match

---

## How it works

- A match is one record shared by both players.
- Each match has one or more games with raw scores.
- All stats and Elo are derived from active match records.
- Matches are never hard-deleted. They can be marked inactive for auditability.
- Edits create an audit trail so changes are transparent.

---

## Pages you will see

- Login
- Submit Match
- Leaderboard
- Player Profile (stats + overview)
- Player Matches
- Update Password (from reset email)

Navigation is mobile-first and optimized for quick use during a match.

---

## Tech stack

Frontend:
- Vue 3
- TypeScript
- Vite
- Hosted on GitHub Pages

Backend / Data:
- Supabase (PostgreSQL + Supabase Auth)
- No custom backend servers
- Frontend talks directly to Supabase via the SDK

---

## Password reset (Supabase Auth)

Add the redirect URL in Supabase Dashboard → Authentication → URL Configuration.
Example (hash-router):
- `https://your-site.com/#/account/update-password`

Trigger reset email from the client:
- `supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://your-site.com/#/account/update-password' })`

---

## What this app does not try to do

- No anti-cheat or moderation system
- No real-time scoring
- No offline mode
- No scheduling or fixtures
- Not built for large public leagues

---

## Status

This project is intentionally small and focused. New features should keep the app simple, correct, and easy to audit.
