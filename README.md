# Muse Mate

Design-project tracker for the Intelligent Mate platform: vision/palette direction,
room-by-room item checklists with AI-assisted price-shopping, a to-scale floor-plan
canvas, and a lightweight budget rollup. Owner + a small number of invited
collaborators per project. Not a public product, not billed.

## Stack

- Next.js 14 (App Router), plain CSS + CSS custom properties (no Tailwind)
- Supabase (DB + Auth), cookie-based sessions via `@supabase/ssr`
- Resend for transactional + auth email
- Anthropic API, server-side only (`ANTHROPIC_MODEL`, default `claude-sonnet-5`)
- Shared UI from `@intelligent-mate/ui` (local `file:` dependency)
- PWA via `@ducanh2912/next-pwa`

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev
```

The shared UI package lives at `../../intelligent-mate-ui` and must be built
(`npm run build` in that folder) before installing here.

## Database

Migrations live in `supabase/migrations/`, numbered sequentially. Run them by hand
in the Supabase SQL Editor in order — Claude Code does not apply them. After
applying, fill `.env.local` and run `npm run db:smoke` to verify the schema.

## Build standards

This app follows `The Intelligent Mate Platform build standards.docx`. Notable
points: `data-theme` light/dark with FOUC guard, semantic status color tokens,
`isSupabaseConfigured()` guard, password auth + `AuthGate` (not middleware),
in-app-browser detection, PWA verified against a real production build.
