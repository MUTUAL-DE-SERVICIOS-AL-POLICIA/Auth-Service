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

# Los enlaces pertenecen al tema de Keycloak. Se generan al iniciar el
# contenedor para poder cambiarlos por ambiente sin reconstruir la imagen.
for variable in \
  KEYCLOAK_LOGIN_HELP_URL \
  KEYCLOAK_OTP_SETUP_HELP_URL \
  KEYCLOAK_OTP_USAGE_HELP_URL \
  KEYCLOAK_OTP_MANUAL_HELP_URL; do
  eval "value=\${$variable:-}"
  if [ -n "$value" ] && [ "${value#https://}" = "$value" ]; then
    echo "$variable must be empty or use HTTPS" >&2
    exit 1
  fi
done

theme_properties=/opt/keycloak/themes/muserpol/login/theme.properties
cat > "$theme_properties" <<EOF
parent=keycloak
import=common/keycloak
styles=css/login.css
loginHelpUrl=${KEYCLOAK_LOGIN_HELP_URL:-}
freeOtpHelpUrl=${KEYCLOAK_OTP_SETUP_HELP_URL:-}
freeOtpUsageHelpUrl=${KEYCLOAK_OTP_USAGE_HELP_URL:-}
freeOtpManualHelpUrl=${KEYCLOAK_OTP_MANUAL_HELP_URL:-}
EOF

exec /opt/keycloak/bin/kc.sh "$@"
