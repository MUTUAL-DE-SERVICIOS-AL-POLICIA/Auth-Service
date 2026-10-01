#!/bin/sh
set -eu

required_variables="
KC_DB_URL_HOST
KC_DB_URL_DATABASE
KC_DB_USERNAME
KC_DB_PASSWORD
KC_HOSTNAME
KC_BOOTSTRAP_ADMIN_USER
KC_BOOTSTRAP_ADMIN_PASSWORD
"

for variable in $required_variables; do
  eval "value=\${$variable:-}"
  if [ -z "$value" ]; then
    echo "$variable is required" >&2
    exit 1
  fi
done

exec /opt/keycloak/bin/kc.sh "$@"
