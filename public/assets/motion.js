// Shared motion helpers. Decorative only: under prefers-reduced-motion
// every helper applies the final state immediately (theme.css kills the
// keyframes globally).

export const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Restart a CSS animation on an element (entrances, stamps, flashes).
export function replay(node) {
  node.style.animation = "none";
  void node.offsetWidth;
  node.style.animation = "";
}

// Count a number up from 0. `format` maps the current value to text.
export function countUp(node, target, { duration = 1100, format = (v) => String(v) } = {}) {
  if (reduced()) {
    node.textContent = format(target);
    return;
  }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const frame = (now) => {
    const p = Math.min((now - t0) / duration, 1);
    node.textContent = format(target * ease(p));
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// Scroll reveal: elements with [data-reveal] slide in when they enter the
// viewport; --i staggers siblings. Without IO (or with reduced motion)
// everything is shown immediately.
export function reveal(root = document) {
  const nodes = [...root.querySelectorAll("[data-reveal]:not(.in)")];
  if (typeof IntersectionObserver === "undefined" || reduced()) {
    for (const n of nodes) n.classList.add("in");
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  for (const n of nodes) io.observe(n);
}
