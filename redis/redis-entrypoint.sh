#!/bin/sh
set -eu

if [ -z "${WEB_REDIS_PASSWORD:-}" ]; then
  echo "WEB_REDIS_PASSWORD is required" >&2
  exit 1
fi

exec /usr/local/bin/docker-entrypoint.sh "$@" --requirepass "$WEB_REDIS_PASSWORD"
