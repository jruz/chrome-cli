# check=skip=InvalidDefaultArgInFrom
ARG GO_VERSION
FROM golang:${GO_VERSION}

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install --yes --no-install-recommends chromium \
    && printf '%s\n' '#!/bin/sh' 'exec /usr/bin/chromium --no-sandbox "$@"' \
        > /usr/local/bin/chromium-test \
    && chmod 755 /usr/local/bin/chromium-test

WORKDIR /app
