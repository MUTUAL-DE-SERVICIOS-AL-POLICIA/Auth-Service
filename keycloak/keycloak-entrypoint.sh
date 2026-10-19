#!/bin/sh
set -eu

required_variables="
DB_HOST
DB_PORT
DB_DATABASE
DB_USERNAME
DB_PASSWORD
KC_DB_SCHEMA
AUTH_PUBLIC_ORIGIN
KEYCLOAK_PORT
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

# Keycloak comparte la conexión PostgreSQL DB_* del launcher. Solo mantiene un
# schema propio, configurable mediante KC_DB_SCHEMA.
export KC_DB_URL_HOST="$DB_HOST"
export KC_DB_URL_PORT="$DB_PORT"
export KC_DB_URL_DATABASE="$DB_DATABASE"
export KC_DB_USERNAME="$DB_USERNAME"
export KC_DB_PASSWORD="$DB_PASSWORD"

# Si no existe un override, el hostname público se deriva del origen común y
# del puerto publicado de Keycloak.
public_origin=${AUTH_PUBLIC_ORIGIN%/}
case "$public_origin" in
  http://*|https://*) ;;
  *)
    echo "AUTH_PUBLIC_ORIGIN must be an HTTP(S) origin" >&2
    exit 1
    ;;
esac
origin_authority=${public_origin#*://}
case "$origin_authority" in
  */*|*@*|*:*|*\?*|*\#*)
    echo "AUTH_PUBLIC_ORIGIN must not contain credentials, port, path, query or fragment" >&2
    exit 1
    ;;
esac

case "$public_origin:$KEYCLOAK_PORT" in
  http://*:80|https://*:443)
    default_keycloak_hostname=$public_origin
    ;;
  *)
    default_keycloak_hostname="$public_origin:$KEYCLOAK_PORT"
    ;;
esac
export KC_HOSTNAME=${KC_HOSTNAME:-$default_keycloak_hostname}

# El tema utiliza el mismo entorno general del launcher. Solo se publican los
# valores conocidos y en produccion la etiqueta permanece oculta.
case "${ENVIRONMENT:-prod}" in
  dev|test|prod)
    theme_environment="${ENVIRONMENT:-prod}"
    ;;
  *)
    echo "ENVIRONMENT must be one of: dev, test, prod" >&2
    exit 1
    ;;
esac

environment_script="window.MUSERPOL_DEPLOY_ENV = '${theme_environment}';"
printf '%s\n' "$environment_script" > /opt/keycloak/themes/muserpol/login/resources/js/environment.js
printf '%s\n' "$environment_script" > /opt/keycloak/themes/muserpol/account/resources/js/environment.js

# Los enlaces pertenecen al tema de Keycloak. Se generan al iniciar el
# contenedor para poder cambiarlos por ambiente sin reconstruir la imagen.
manual_url=${KEYCLOAK_USER_MANUAL_URL:-}
if [ -n "$manual_url" ] && [ "${manual_url#https://}" = "$manual_url" ]; then
  echo "KEYCLOAK_USER_MANUAL_URL must be empty or use HTTPS" >&2
  exit 1
fi

theme_properties=/opt/keycloak/themes/muserpol/login/theme.properties
cat > "$theme_properties" <<EOF
parent=keycloak
import=common/keycloak
styles=css/login.css
loginHelpUrl=${manual_url}
freeOtpHelpUrl=${manual_url}
freeOtpUsageHelpUrl=${manual_url}
EOF

exec /opt/keycloak/bin/kc.sh "$@"
