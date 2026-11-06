// Shared left rail. One place to change navigation.
const links = [["/", "Atlas"], ["/console.html", "Console"], ["/console.html#join", "Join council"]];
export function mountRail(el, current) {
  const brand = document.createElement("a");
  brand.className = "brand"; brand.href = "/"; brand.textContent = "Council Agent";
  el.replaceChildren(brand, ...links.map(([href, text]) => {
    const a = document.createElement("a");
    a.href = href; a.textContent = text;
    if (href === current) a.setAttribute("aria-current", "page");
    return a;
  }));
}
