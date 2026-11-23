FROM rust:1-bookworm AS analyzer-builder
WORKDIR /app/analyzer

# Build dependencies first with stub sources so this layer is cached
# until Cargo.toml / Cargo.lock change.
COPY analyzer/Cargo.toml analyzer/Cargo.lock analyzer/build.rs ./
RUN mkdir src \
  && echo 'fn main() {}' > src/main.rs \
  && touch src/lib.rs \
  && cargo build --release --locked \
  && rm -rf src

COPY analyzer/src ./src
# Make sure cargo rebuilds the crate itself instead of reusing the stub.
RUN touch src/main.rs src/lib.rs && cargo build --release --locked

FROM node:22-bookworm-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV ANALYZER_BIN=/app/analyzer/analyzer

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY ui/package*.json /app/ui/
WORKDIR /app/ui
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --from=analyzer-builder /app/analyzer/target/release/analyzer /app/analyzer/analyzer
COPY --from=ui-builder /app/ui/dist /app/ui/dist
COPY --from=ui-builder /app/ui/dist-server /app/ui/dist-server

# Run as the unprivileged user shipped with the node image.
USER node

# The server listens on $PORT (set by Render), defaulting to 3002.
EXPOSE 3002
CMD ["node", "dist-server/server.js"]
