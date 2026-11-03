# BuPulse on Google Cloud Run (docs/DEPLOY_CLOUDRUN.md). Built by Cloud Build from source (cloudbuild.yaml), never
# locally: linux/amd64, Node 24 (the version Netlify and CI run), Next.js standalone output (next.config.ts, with
# BUILD_TARGET=cloudrun). Nothing secret goes in: .gcloudignore and .dockerignore keep every .env file out, the
# NEXT_PUBLIC_* build arguments are public values (they end up in the browser's JavaScript anyway), and the runtime
# secrets are Cloud Run environment variables.

# Dependencies, installed for Linux so sharp and Prisma get their Linux builds.
FROM --platform=linux/amd64 node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Inlined into the build like on Netlify (the deploy workflow's build values). Pass them with --build-arg
# (cloudbuild.yaml does).
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_WHATSAPP_NUMBER=""
ARG BUILD_SHA=local
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_WHATSAPP_NUMBER=$NEXT_PUBLIC_WHATSAPP_NUMBER \
    BUILD_SHA=$BUILD_SHA \
    BUILD_TARGET=cloudrun \
    PLATFORM=cloudrun \
    NODE_OPTIONS=--max-old-space-size=6144
RUN test -n "$NEXT_PUBLIC_SITE_URL" -a -n "$NEXT_PUBLIC_SUPABASE_URL" -a -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
      || { echo "NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are needed (--build-arg)"; exit 1; }
RUN npx prisma generate --config prisma7.config.ts && npm run build

# The image Cloud Run runs: the standalone server and only the files it traced, plus the static files, public/, and
# sharp with its Linux binaries (loaded by a computed path the tracer cannot follow).
FROM --platform=linux/amd64 node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLATFORM=cloudrun \
    PORT=8080
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/node_modules/sharp ./node_modules/sharp
COPY --from=build --chown=node:node /app/node_modules/@img ./node_modules/@img
COPY --from=build --chown=node:node /app/node_modules/detect-libc ./node_modules/detect-libc
COPY --from=build --chown=node:node /app/node_modules/semver ./node_modules/semver
USER node
EXPOSE 8080
# Cloud Run gives the port in PORT. HOSTNAME is set here, not with ENV, because a container runtime may set its own:
# the server must listen on every address (Cloud Run's front end, and the tick's calls to 127.0.0.1).
CMD ["/usr/bin/env", "HOSTNAME=0.0.0.0", "node", "server.js"]
