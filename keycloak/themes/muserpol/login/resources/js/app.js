
const pwd = document.querySelector("#password") || document.querySelector("input[type='password']");
if (pwd) {
  pwd.addEventListener("keyup", (e) => {
    const isCaps = e.getModifierState && e.getModifierState("CapsLock");
    let hint = document.getElementById("caps-hint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "caps-hint";
      hint.className = "kc-help-text";
      pwd.parentElement.appendChild(hint);
    }
    hint.textContent = isCaps ? "Bloq Mayús activado" : "";
  });
}

const environmentLabels = {
  dev: "VERSIÓN DE DESARROLLO",
  test: "VERSIÓN DE PRUEBAS",
};
const environmentLabel = environmentLabels[window.MUSERPOL_DEPLOY_ENV];
const brand = document.querySelector(".kc-brand");
if (environmentLabel && brand) {
  const badge = document.createElement("span");
  badge.className = "kc-environment-badge";
  badge.textContent = environmentLabel;
  brand.insertAdjacentElement("afterend", badge);
}
