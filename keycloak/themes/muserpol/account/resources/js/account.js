// Keycloak 26.0.1 follows the OS theme unconditionally. This brand uses light mode.
// Observe only the root class: do not interfere with React, forms or authentication.
const root = document.documentElement;
const keepLightTheme = () => {
  if (root.classList.contains("pf-v5-theme-dark")) {
    root.classList.remove("pf-v5-theme-dark");
  }
};
keepLightTheme();
new MutationObserver(keepLightTheme).observe(root, {
  attributes: true,
  attributeFilter: ["class"],
});


// Keep the brand as an image, without navigation to the server welcome page.
// React mounts the masthead asynchronously and may render it again on navigation.
const removeBrandLink = () => {
  document.querySelectorAll(".pf-v5-c-masthead__brand[href]").forEach((brand) => {
    brand.removeAttribute("href");
    brand.removeAttribute("target");
    brand.removeAttribute("role");
    brand.setAttribute("tabindex", "-1");
  });
};
removeBrandLink();
new MutationObserver(removeBrandLink).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["href"],
});
