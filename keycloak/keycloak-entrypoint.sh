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

exec /opt/keycloak/bin/kc.sh "$@"
