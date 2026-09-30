<#import "template.ftl" as layout>
<@layout.registrationLayout showVisual=false displayMessage=!messagesPerField.existsError('totp','userLabel'); section>
  <#if section = "header">
    ${msg("loginTotpTitle")}
  <#elseif section = "form">
    <ol id="kc-totp-settings">
      <li>
        <div class="kc-freeotp-install">
          <p class="kc-freeotp-text">${kcSanitize(msg("loginTotpStep1"))?no_esc}</p>
          <img class="kc-freeotp-logo" src="${url.resourcesPath}/img/freeotp-logo.png" alt="FreeOTP"/>
        </div>
      </li>

      <li>
        <p>${msg("loginTotpStep2")}</p>
        <img id="kc-totp-secret-qr-code" src="data:image/png;base64, ${totp.totpSecretQrCode}" alt="Figure: Barcode"/>
        <br/>
        <a href="#" id="kc-totp-secret-key-toggle">${msg("loginTotpUnableToScan")}</a>
        <div id="kc-totp-secret-key" style="display:none">
          <p style="font-size:0.85rem;color:#555;margin-bottom:4px;">
            Si no puedes escanear el código QR, ingresa manualmente esta clave en tu aplicación FreeOTP
            seleccionando la opción <strong>"Ingresar clave manualmente"</strong>:
          </p>
          <span style="display:block;font-family:monospace;font-size:1.1rem;letter-spacing:2px;background:#f4f4f4;padding:8px 12px;border-radius:6px;word-break:break-all;">${totp.totpSecretEncoded}</span>
          <#assign manualHelpUrl = (properties.freeOtpManualHelpUrl!'')?trim>
          <#if manualHelpUrl?starts_with('https://')>
            <p class="kc-help">
              <a href="${manualHelpUrl}" target="_blank" rel="noopener noreferrer">
                Ver guía para ingresar la clave manualmente
              </a>
            </p>
          </#if>
        </div>
      </li>

      <li>
        <p>${kcSanitize(msg("loginTotpStep3"))?no_esc}</p>
      </li>
    </ol>

    <form action="${url.loginAction}" class="${properties.kcFormClass!}" id="kc-totp-settings-form" method="post">
      <input type="hidden" id="totpSecret" name="totpSecret" value="${totp.totpSecret}"/>
      <div class="${properties.kcFormGroupClass!}">
        <div class="${properties.kcLabelWrapperClass!}">
          <label for="totp" class="${properties.kcLabelClass!}">${msg("authenticatorCode")}</label>
          <span class="${properties.kcLabelClass!} ${properties.kcLabelPrimaryClass!}">*</span>
        </div>
        <div class="${properties.kcInputWrapperClass!}">
          <input type="text" id="totp" name="totp" autocomplete="off"
                 class="${properties.kcInputClass!}"
                 aria-invalid="<#if messagesPerField.existsError('totp')>true</#if>"/>
          <#if messagesPerField.existsError('totp')>
            <span id="input-error-otp-code" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">
              ${kcSanitize(messagesPerField.get('totp'))?no_esc}
            </span>
          </#if>
        </div>
      </div>

      <input type="hidden" id="userLabel" name="userLabel" value=""/>
        <script>
        (function() {
          var input = document.getElementById('userLabel');
          var now = new Date();
          var dd = String(now.getDate()).padStart(2, '0');
          var mm = String(now.getMonth() + 1).padStart(2, '0');
          var yyyy = now.getFullYear();
          input.value = "Dispositivo OTP - " + dd + "/" + mm + "/" + yyyy;
        })();
        </script>
      <#if isAppInitiatedAction??>
        <div class="kc-checkbox-row">
          <label for="logout-sessions">
            <input type="checkbox" id="logout-sessions" name="logout-sessions" value="on" checked/>
            <span>${msg("logoutOtherSessions")}</span>
          </label>
        </div>
      </#if>

      <div class="${properties.kcFormGroupClass!}">
        <div id="kc-form-buttons" class="${properties.kcFormButtonsClass!}">
          <input type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonPrimaryClass!} ${properties.kcButtonLargeClass!}"
                 id="saveTOTPBtn" value="${msg("doSubmit")}"/>
          <#if isAppInitiatedAction??>
            <button type="submit" class="${properties.kcButtonClass!} ${properties.kcButtonDefaultClass!} ${properties.kcButtonLargeClass!}"
                    id="cancelTOTPBtn" name="cancel-aia" value="true">${msg("doCancel")}</button>
          </#if>
        </div>
      </div>
    </form>
  </#if>
</@layout.registrationLayout>