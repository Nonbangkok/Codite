FROM rust:1-bookworm AS analyzer-builder
WORKDIR /app/analyzer
COPY analyzer/Cargo.toml analyzer/Cargo.lock ./
COPY analyzer/build.rs ./build.rs
COPY analyzer/src ./src
RUN cargo build --release --locked

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

COPY --from=analyzer-builder /app/analyzer/target/release/analyzer /app/analyzer/analyzer
COPY --from=ui-builder /app/ui/dist /app/ui/dist
COPY --from=ui-builder /app/ui/dist-server /app/ui/dist-server
COPY ui/package*.json /app/ui/

WORKDIR /app/ui
RUN npm ci --omit=dev \
  && npm cache clean --force

EXPOSE 3001
CMD ["npm", "start"]
