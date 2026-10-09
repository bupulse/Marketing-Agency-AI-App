# BuPulse

# BuPulse

The AI marketing team for every small business: content generation, a lead-capturing
chat widget, and (later) video, voiceover and performance learning.

Stack: Next.js 16 (TypeScript, Tailwind), Supabase (Postgres + Auth), Prisma 7, Gemini / Claude.

## Folders

- `app/` – pages and API routes (`app/dashboard`, `app/api`, `app/login`, `app/auth`)
- `lib/ai/` – AI provider interfaces (`TextProvider`, `ImageProvider`, `VideoProvider`, `VoiceProvider`)
  and implementations. Switch text providers with `AI_TEXT_PROVIDER=gemini|claude`.
- `lib/plans.ts`, `lib/usage.ts` – plan limits and atomic usage enforcement
- `prisma/schema.prisma` – database schema
- `components/` – shared UI (empty until the UI phase)

## Run locally

1. `cp .env.example .env` and fill in the Supabase and Gemini values.
2. `npx prisma migrate dev --name init` – creates the tables in Supabase.
3. `npm run dev` and open http://localhost:3000/login

Trial: 7 days, 10 text generations and 5 images. Limits live in `lib/plans.ts`.
