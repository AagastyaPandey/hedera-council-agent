// Motion helpers shared by the council pages. Pure DOM, no dependencies.
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

// Same ease as the original page's count-up (1 - 2^-10t).
export function countTo(el, target, { delay = 0, decimals = 2, duration = 1200, suffix = "" } = {}) {
  if (!el) return;
  const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (reduced()) { el.textContent = fmt(target); return; }
  el.textContent = fmt(0);
  let start = null;
  const frame = (ts) => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / duration);
    el.textContent = fmt(t === 1 ? target : target * (1 - Math.pow(2, -10 * t)));
    if (t < 1) requestAnimationFrame(frame);
  };
  setTimeout(() => requestAnimationFrame(frame), delay);
}

export function typewrite(el, text, { delay = 0, cps = 90 } = {}) {
  if (!el) return;
  if (reduced()) { el.textContent = text; return; }
  el.textContent = "";
  setTimeout(() => {
    let i = 0;
    const id = setInterval(() => { i += 2; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(id); }, 1000 / (cps / 2));
  }, delay);
}

// Re-trigger a CSS animation class on an element.
export function replay(el, cls, delay) {
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth;
  if (delay !== undefined) el.style.setProperty("--d", `${delay}s`);
  el.classList.add(cls);
}

// Stagger a list of nodes in with m-reveal.
export function stagger(nodes, base = 0, step = 0.08) {
  [...nodes].forEach((n, i) => { n.style.setProperty("--d", `${(base + i * step).toFixed(2)}s`); n.classList.remove("m-reveal"); void n.offsetWidth; n.classList.add("m-reveal"); });
}

// The agent-working strip: shows the real order of what the agent does while the request is in flight.
// Waits at least `min` ms so the steps are readable even when the simulated agent answers instantly.
export const AGENT_STEPS = ["Read the transfer", "Pay for the check", "0G verdict", "Compare fields", "World ID, then sign"];
export async function whileWorking(bar, work, min = 1500) {
  const items = [...bar.querySelectorAll("li")];
  if (reduced()) return work();
  bar.classList.add("on");
  items.forEach((li) => li.classList.remove("now", "done"));
  let stop = false, i = 0;
  const run = (async () => {
    while (!stop) {
      items.forEach((li, k) => { li.classList.toggle("done", k < i); li.classList.toggle("now", k === i); });
      if (i < items.length - 1) i += 1;
      await sleep(min / items.length);
    }
  })();
  const [result] = await Promise.all([work(), sleep(min)]);
  stop = true; await run;
  items.forEach((li) => { li.classList.remove("now"); li.classList.add("done"); });
  await sleep(350);
  bar.classList.remove("on");
  return result;
}

// Packet run along a flow strip. `stops` = index of the node the packet stops at (0-based); passed = reached the end.
export function runFlow(flow, { stop, ok }) {
  const nodes = [...flow.querySelectorAll(".node")];
  const fill = flow.querySelector(".fill"), packet = flow.querySelector(".packet");
  const pct = (k) => (nodes.length === 1 ? 100 : (k / (nodes.length - 1)) * 100);
  flow.dataset.end = ok ? "pass" : "fail";
  if (reduced()) {
    fill.style.width = `${pct(stop)}%`; packet.style.left = `${pct(stop)}%`;
    nodes.forEach((n, k) => n.classList.toggle("lit", k <= stop)); return;
  }
  fill.style.width = "0%"; packet.style.left = "0%";
  const seg = 650;
  nodes.forEach((n, k) => { n.classList.remove("lit"); if (k === 0) setTimeout(() => n.classList.add("lit"), 100); });
  for (let k = 1; k <= stop; k++) {
    setTimeout(() => {
      fill.style.transition = packet.style.transition = `all ${seg}ms cubic-bezier(.6,0,.2,1)`;
      fill.style.width = `${pct(k)}%`; packet.style.left = `${pct(k)}%`;
    }, 300 + (k - 1) * (seg + 150));
    setTimeout(() => nodes[k].classList.add("lit"), 300 + k * (seg + 150) - 150);
  }
  // nodes after the stop stay dark; they are lit only when reached
}
