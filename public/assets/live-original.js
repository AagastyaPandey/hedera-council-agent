// Fills the original Atlas and Report pages with live data from the
// server. The pages' own markup, CSS and animation are untouched; this
// module only sets text, so replacing a page needs no backend change.
import { api, hbar, qs } from "/assets/api.js";

const $ = (id) => document.getElementById(id);
const short = (h, n = 10) => (h ? `${h.slice(0, n)}…` : "—");
const text = (el, t) => { if (el) el.textContent = t; };
const col = (el, label, rows) => {
  if (!el) return;
  el.replaceChildren();
  const l = document.createElement("div"); l.className = "label"; l.textContent = label;
  const p = document.createElement("p");
  rows.forEach(([k, v, href], i) => {
    if (i) p.append(document.createElement("br"));
    p.append(document.createTextNode(`${k} `));
    const b = document.createElement(href ? "a" : "b");
    if (href) b.href = href;
    b.textContent = v;
    p.append(b);
  });
  el.append(l, p);
};

// Rebuild a statement's animated lines. The page's CSS animates .l > span.
function lines(p, rows, base = 1.25) {
  if (!p) return;
  p.replaceChildren(...rows.map((t, i) => {
    const l = document.createElement("span"); l.className = "l";
    const s = document.createElement("span"); s.textContent = t;
    s.style.animationDelay = `${(base + i * 0.08).toFixed(3)}s`;
    l.append(s);
    return l;
  }));
}


// Same ease as the original page's count-up (1 - 2^-10t), with decimals for HBAR amounts.
function countTo(el, target, delay, decimals = 2) {
  if (!el) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  if (reduce) { el.textContent = fmt(target); return; }
  el.textContent = "0";
  let start = null;
  const frame = (ts) => {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / 1400);
    el.textContent = fmt(t === 1 ? target : target * (1 - Math.pow(2, -10 * t)));
    if (t < 1) requestAnimationFrame(frame);
  };
  setTimeout(() => requestAnimationFrame(frame), delay);
}
const GLYPHS = "\u2593\u2592\u2591#@%&*+=<>/|01";
function scrambleIn(el, final, delay) {
  if (!el) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = final; return; }
  setTimeout(() => {
    let i = 0; const frames = 11;
    const id = setInterval(() => {
      i += 1; const done = Math.floor((final.length * i) / frames);
      el.textContent = final.slice(0, done) + [...final.slice(done)].map((c) => (c === " " ? " " : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
      if (i >= frames) { clearInterval(id); el.textContent = final; }
    }, 26);
  }, delay);
}

const [health, list, seats, policy, verify] = await Promise.all([
  api.health(), api.proposals(), api.seats(),
  fetch("/policy").then((r) => r.json()).catch(() => ({})),
  fetch("/audit/verify").then((r) => r.json()).catch(() => ({})),
]);
const h = health.data;
const rows = list.data.proposals ?? [];
const signed = rows.filter((p) => p.decision === "SIGNED").length;
const refused = rows.filter((p) => p.decision === "REFUSED").length;
const latest = rows.at(-1);
const logLine = verify.ok ? `verified, ${verify.checked} entries` : verify.checked === 0 ? "empty" : "BROKEN";

if (document.body.querySelector(".hero .scene")) {
  // ---------------- Atlas ----------------
  text($("sourceChip"), h.mode === "real" ? "Live" : "Simulated");
  if (h.mode === "real") $("sourceChip").classList.add("on");
  window.LIVE_TICKER = `COUNCIL ${signed} SIGNED \u00b7 ${refused} REFUSED \u00b7 ${rows.length} PROPOSALS \u00b7 LOG ${logLine.toUpperCase()}`;
  if (latest) {
    const href = `/report.html?from=atlas&proposal=${encodeURIComponent(latest.id)}`;
    $("ctaReport").href = href;
    $("navReport").href = `/report.html?proposal=${encodeURIComponent(latest.id)}`;
  }
  // Drive the replay timeline from the real proposals. Links: b1 treasury-agent, b2 treasury-council, b3 treasury-World ID.
  if (window.ATLAS_MODEL && rows.length) {
    const mismatch = rows.find((p) => p.decision === "REFUSED" && !p.matches);
    const worldBlocked = rows.find((p) => p.decision === "REFUSED" && p.matches && p.large);
    const firstSigned = rows.find((p) => p.decision === "SIGNED");
    const all = { b1: "open", b2: "open", b3: "open" };
    const phases = [
      { t: 0, chains: {}, links: {}, note: `Genesis · ${rows.length} proposals` },
      { t: 3, chains: {}, links: { b1: "open" }, note: "Treasury scheduled" },
      { t: 6, chains: {}, links: { b1: "open", b2: "open" }, note: "Check paid over x402" },
      { t: 9, chains: {}, links: all, note: "All nodes linked" },
      { t: 13, chains: { rollup: "degraded" }, links: all, note: firstSigned ? `Agent checking · ${firstSigned.id} matches` : "Agent checking" },
    ];
    if (mismatch) phases.push({ t: 17, chains: { rollup: "degraded" }, links: { ...all, b2: "severed" }, note: `${mismatch.id} refused · transfer mismatch` });
    if (worldBlocked) phases.push({ t: 21, chains: { rollup: "degraded", outpost: "dark" }, links: { ...all, ...(mismatch ? { b2: "severed" } : {}) }, note: `${worldBlocked.id} waits · World ID required` });
    phases.push({ t: 25, chains: {}, links: all, note: `${signed} signed · ${refused} refused · log ${logLine}` });
    window.ATLAS_MODEL.phases.length = 0;
    window.ATLAS_MODEL.phases.push(...phases);
  }
  const cols = document.querySelectorAll(".footer .col");
  col(cols[0], "Council", [["Proposals", String(rows.length).padStart(2, "0")], ["Signed", String(signed).padStart(2, "0")], ["Refused", String(refused).padStart(2, "0")], ["Seats", String(seats.data.count).padStart(2, "0")]]);
  col(cols[1], "Traffic", [["Check price", h.checkPrice], ["Spend left", h.spendCapRemaining], ["Mode", h.mode], ["Buyer", h.x402Buyer.startsWith("real") ? "x402" : "sim"]]);
  col(cols[2], "Reading", [["policy", short(policy.hash, 8), "/policy"], ["log", logLine, "/audit/verify"], ["topic", String(h.hcsTopic).slice(0, 14)], ["treasury", String(h.treasury).slice(0, 14)]]);
} else {
  // ---------------- Report ----------------
  const id = qs("proposal") ?? latest?.id;
  const r = id ? await api.proposal(id) : null;
  window.LIVE_STATUSES.push(`LOG ${logLine.toUpperCase()}`, `POLICY ${short(policy.hash, 8).toUpperCase()}`, `MODE ${h.mode.toUpperCase()}`);
  text($("mFlagged"), String(refused).padStart(2, "0"));
  text($("mUSDC"), String(signed).padStart(2, "0"));
  const ticker = `COUNCIL AGENT \u00b7 ${signed} SIGNED \u00b7 ${refused} REFUSED \u00b7 LOG ${logLine.toUpperCase()} \u00b7 POLICY ${short(policy.hash, 8).toUpperCase()} \u00b7 `;
  for (const t of [$("tickA"), $("tickB")]) text(t, ticker + ticker + ticker);
  const foot = document.querySelectorAll("#reportFooter .col");
  col(foot[0], "Council", [["Proposals", String(rows.length).padStart(2, "0")], ["Signed", String(signed).padStart(2, "0")], ["Refused", String(refused).padStart(2, "0")], ["Seats", String(seats.data.count).padStart(2, "0")]]);
  col(foot[3], "Read", [["policy", "/policy", "/policy"], ["log", "/audit", "/audit"], ["verify", "/audit/verify", "/audit/verify"], ["evidence", id ? `/proposals/${id}/evidence` : "—", id ? `/proposals/${encodeURIComponent(id)}/evidence` : undefined]]);
  if (!r || !r.ok) {
    text($("tVerdict"), "None yet"); text($("tLayer"), h.mode); text($("tProp"), "—");
    text($("numL"), "00"); text($("numR"), "00");
    lines(document.querySelectorAll(".statement")[0], ["No proposal yet.", "Open the console", "and submit one."]);
    col(foot[1], "Check", [["Price", h.checkPrice], ["Spend left", h.spendCapRemaining]]);
    col(foot[2], "Commitment", [["policy", short(policy.hash, 12)]]);
  } else {
    const { proposal: p, check, lastOutcome: o, large } = r.data;
    const decision = o?.decision ?? "PENDING";
    const d = hbar(p.description.amountTinybars), a = hbar(p.transfer.amountTinybars);
    const num = (t) => (t / 1e8).toLocaleString(undefined, { maximumFractionDigits: 2 });
    text($("tVerdict"), check.matches ? (decision === "SIGNED" ? "Signed" : decision === "REFUSED" ? "Refused" : "Matches") : "Mismatch");
    text($("tLayer"), `${h.mode} · ${o?.transferSource === "hedera-mirror-node" ? "on-chain" : "request"}`);
    text($("tProp"), p.id);
    countTo($("numL"), p.description.amountTinybars / 1e8, 950);
    countTo($("numR"), p.transfer.amountTinybars / 1e8, 1190);
    scrambleIn($("stampText"), decision === "PENDING" ? "Pending" : decision === "SIGNED" ? "Signed" : "Refused", 1900);
    text($("stampSub"), o?.auditHash ? `0x${o.auditHash.slice(0, 8)}` : p.id);
    const st = document.querySelectorAll(".statement");
    lines(st[0], check.matches
      ? [`${p.id} matches.`, `${d} to ${p.description.payee}.`, large ? "It is a large one." : "It is a routine one.", large ? "World ID decides." : "No gate needed.", decision === "SIGNED" ? "The agent signed." : decision === "REFUSED" ? "The agent refused." : "Not yet submitted."]
      : ["The description said", `${d} to ${p.description.payee}.`, "The transfer does", "something else:", `${a} to ${p.transfer.payee}.`, "The agent refused."]);
    lines(st[1], ["Binding decisions to", "what is on Hedera,", "with a paid check,", "a published policy", "and a log you can", "verify yourself.", `Policy ${short(policy.hash, 8)}`], 1.6);
    window.LIVE_STATUSES.push(`${p.id} ${decision}`);
    col(foot[1], "Check", [["Result", check.matches ? "matches" : "mismatch"], ["Paid via", o?.paidVia ?? "—"], ["Price", h.checkPrice], ["Gate", o?.worldGateReason ? "blocked" : large ? "required" : "none"]]);
    col(foot[2], "Commitment", [["policy", short(policy.hash, 12)], ["entry", short(o?.auditHash, 12)], ["schedule", o?.scheduledTxId ?? "—"], ["0G", o?.zeroGRequestId ? short(o.zeroGRequestId, 12) : o?.zeroGSource ?? "—"]]);
  }
}
