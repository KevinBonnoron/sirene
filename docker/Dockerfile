# syntax=docker/dockerfile:1

# ── Client (SPA) ─────────────────────────────────────────────────────────────

FROM --platform=$BUILDPLATFORM oven/bun:1.3.10 AS client

WORKDIR /src
COPY package.json bun.lock ./
COPY client/package.json client/
COPY shared/package.json shared/
COPY cli/package.json cli/
COPY inference/package.json inference/
COPY docs/package.json docs/
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY shared shared
COPY client client
RUN bun run -F @sirene/client build

# ── Server (Go, cross-compiled for the target platform) ──────────────────────

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS server

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev

WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY server server
COPY shared/src/types shared/src/types
COPY --from=client /src/client/dist server/ui/dist
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w -X github.com/KevinBonnoron/sirene/server/internal/config.Version=$VERSION" \
    -o /out/sirene ./server/cmd/sirene

# ── Final image ──────────────────────────────────────────────────────────────

# Root variant: existing volumes were written by root under the previous image.
FROM gcr.io/distroless/static-debian12@sha256:d75cdd72874d4790092fcb1b058493ecf6bb5bf2b2b897045b00ff01d91843f2

COPY --from=server /out/sirene /usr/local/bin/sirene

# PocketBase spools request bodies above 16 MB to a temp file.
ENV TMPDIR=/tmp
ENV INFERENCE_URL=http://inference:8000

WORKDIR /app/db
VOLUME /app/db/pb_data
EXPOSE 80

ENTRYPOINT ["/usr/local/bin/sirene"]
CMD ["serve", "--http=0.0.0.0:80", "--dir=/app/db/pb_data"]
