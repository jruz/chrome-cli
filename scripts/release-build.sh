#!/usr/bin/env bash
set -euo pipefail

OS=$1
ARCH=$2
TARGET="bun-${OS}-${ARCH}"
NAME=$(sed -n 's/.*"name".*"\(.*\)".*/\1/p' package.json | head -1)

bun build cli.ts \
    --compile \
    --target "$TARGET" \
    --outfile "${NAME}-${OS}-${ARCH}" \
    --define "process.env.REVISION='${REVISION}'" \
    --define "process.env.BUILD_TIME='$(date -u '+%Y-%m-%d %H:%M:%S UTC')'"
