// Shared by /mandate.html, /council.html and /member.html: who this browser can vote as, joining,
// casting a ballot (World ID or a DEMO identity), and the tally / vote card renderers.
// The server decides everything; this module only relays ballots and draws what it returns.
import { api, emit, hbar } from "./api.js";
import { runWorldFlow, runWorldBallot, runMockedFlow, runWorldInvite, runWorldRevoke } from "./world-flow.js";
import { agentMarkup } from "./council-scene.js";
import { reduced, replay } from "./motion.js";

export const $ = (id) => document.getElementById(id);
export function el(tag, text, cls, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, value);
  return node;
}
export const short = (value, n = 12) => (value ? (value.length > n ? `${value.slice(0, n)}…` : value) : "—");
export const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
export const seatNumber = (seat) => Number(String(seat).split(":").pop()) || 0;

// ---------- identities kept in this browser ----------
// Demo seats carry the stored "mock:" nullifier the server checks on a ballot. A World seat is only
// remembered by id (the proof is made fresh for every ballot).
const ID_KEY = "council.identities";
const ACT_KEY = "council.actAs";
const read = () => { try { const v = JSON.parse(localStorage.getItem(ID_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.seat === "string") : []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(ID_KEY, JSON.stringify(list)); } catch { /* storage disabled: identities last for this page only */ } };
export const identities = {
  list: read,
  add(entry) { write([...read().filter((x) => x.seat !== entry.seat), entry]); this.use(entry.seat); },
  current() { const list = read(); const pick = localStorage.getItem(ACT_KEY); return list.find((x) => x.seat === pick) ?? list.at(-1) ?? null; },
  find: (seat) => read().find((x) => x.seat === seat) ?? null,
  use(seat) { try { localStorage.setItem(ACT_KEY, seat); } catch { /* ignore */ } },
  // Drop identities for seats the server no longer has (state reset or revocation).
  prune(seatIds) { const keep = new Set(seatIds); const list = read(); const next = list.filter((x) => keep.has(x.seat)); if (next.length !== list.length) write(next); return next; },
};

let worldCache = null;
export async function loadWorld() {
  if (worldCache) return worldCache;
  const r = await api.worldConfig().catch(() => ({ ok: false }));
  worldCache = r.ok ? r.data : { configured: false, mockedAllowed: false };
  return worldCache;
}
export const isDemo = (world) => !world.configured && Boolean(world.mockedAllowed);

// ---------- feedback: status line, QR and API key ----------
export function feedback(statusEl, qrEl) {
  const set = (text, tone = "neutral") => { statusEl.textContent = text; statusEl.dataset.tone = tone; };
  const qr = (svgUrl) => {
    if (!qrEl) return;
    const img = el("img", undefined, undefined, { src: svgUrl, alt: "World ID request: scan with World App", width: "220", height: "220" });
    qrEl.replaceChildren(img); qrEl.hidden = false;
  };
  const clearQr = () => { if (qrEl) { qrEl.replaceChildren(); qrEl.hidden = true; } };
  // A 401 means the server has an API key; ask for it once per session.
  const needKey = (res) => {
    if (res.status !== 401) return false;
    set("This server needs an API key for votes and drafts.", "bad");
    if (statusEl.nextElementSibling?.classList.contains("cv-keybox")) return true;
    const form = el("form", undefined, "cv-keybox");
    const input = el("input", undefined, "cv-input", { type: "password", autocomplete: "off", placeholder: "API key", "aria-label": "API key" });
    form.append(input, el("button", "Use key", "btn", { type: "submit" }));
    form.onsubmit = (e) => { e.preventDefault(); sessionStorage.setItem("councilKey", input.value.trim()); form.remove(); set("API key stored for this session. Try again.", "neutral"); };
    statusEl.after(form); input.focus();
    return true;
  };
  return { set, qr, clearQr, needKey };
}

// ---------- join ----------
// The first seat founds the council; every later seat needs an invite from a seat holder.
// autoInvite (DEMO only): the identity this browser acts as issues the invite first, so one person can add members.
export async function joinCouncil({ world, fb, invite = null, autoInvite = false }) {
  fb.set(world.configured ? "Preparing World ID…" : "Recording a MOCKED council proof (demo only)…", "wait");
  try {
    let code = invite;
    if (!code && autoInvite && !world.configured && world.mockedAllowed) {
      const me = identities.current();
      if (me?.nullifier) {
        fb.set(`Issuing an invite as ${me.seat} (DEMO)…`, "wait");
        const inv = await api.invite({ mocked: true, byNullifier: me.nullifier });
        if (!inv.ok) { if (!fb.needKey(inv)) fb.set(inv.data?.error || "Could not issue an invite.", "bad"); return inv; }
        code = inv.data.code;
      }
    }
    const res = world.configured
      ? await runWorldFlow({ join: true, invite: code, onQr: (_u, svg) => fb.qr(svg), onStatus: (t) => fb.set(t, "wait") })
      : world.mockedAllowed ? await runMockedFlow({ join: true, invite: code })
      : { ok: false, status: 0, data: { error: "World ID is not configured here and demo identities are disabled." } };
    if (res.ok) {
      identities.add({ seat: res.data.seat, source: world.configured ? "world" : "mocked", nullifier: world.configured ? null : res.data.nullifier, joinedAt: new Date().toISOString() });
      const how = res.data.founder ? "founded the council" : `joined with an invite from ${res.data.invitedBy}`;
      fb.set(`${res.data.seat} ${how}${world.configured ? " (World ID)" : " (DEMO identity, MOCKED proof)"}.`, "ok");
    } else if (!fb.needKey(res)) {
      const err = res.data?.error || "Could not join.";
      fb.set(/needs an invite/.test(err) ? "This council already has members: joining needs an invite link from a seat holder." : err, "bad");
    }
    return res;
  } catch {
    fb.set("Could not reach the server. Try again.", "bad");
    return { ok: false, status: 0, data: {} };
  } finally { fb.clearQr(); }
}

// ---------- invites ----------
export async function createInvite({ world, identity, fb }) {
  if (!identity) { fb.set("Join the council first: only a seat holder can invite.", "bad"); return { ok: false, status: 0, data: {} }; }
  fb.set(world.configured ? `Preparing a World ID proof as ${identity.seat}…` : `Issuing an invite as ${identity.seat} (DEMO)…`, "wait");
  try {
    const res = world.configured
      ? await runWorldInvite({ seat: identity.seat, onQr: (_u, svg) => fb.qr(svg), onStatus: (t) => fb.set(t, "wait") })
      : await api.invite({ mocked: true, byNullifier: identity.nullifier });
    if (res.ok) {
      emit("council:invited", res.data);
      fb.set(`Invite ready from ${res.data.by}: single use, valid until ${when(res.data.expiresAt)}.`, "ok");
    } else if (!fb.needKey(res)) fb.set(res.data?.error || "Could not issue an invite.", "bad");
    return res;
  } catch {
    fb.set("Could not reach the server. Try again.", "bad");
    return { ok: false, status: 0, data: {} };
  } finally { fb.clearQr(); }
}

// The code and a copyable join link. The code is a bearer secret: shown once, to its issuer.
export function invitePanel(inv) {
  const box = el("div", undefined, "cv-invite", { role: "group", "aria-label": "Invite link" });
  const url = new URL(inv.link || `/council.html?invite=${encodeURIComponent(inv.code)}`, location.origin).href;
  const head = el("p", undefined, "cv-invite-head");
  head.append(el("span", "Invite", "doc-folio"), el("code", inv.code, "cv-invite-code"), el("small", `from ${inv.by} · single use · until ${when(inv.expiresAt)}`));
  const row = el("div", undefined, "cv-invite-row");
  const input = el("input", undefined, "cv-input cv-invite-link", { type: "text", readonly: "", value: url, "aria-label": "Invite link" });
  input.onfocus = () => input.select();
  const copy = el("button", "Copy link", "btn", { type: "button" });
  copy.onclick = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch { input.select(); try { ok = document.execCommand("copy"); } catch { ok = false; } }
    copy.textContent = ok ? "Copied" : "Select and copy";
    setTimeout(() => { copy.textContent = "Copy link"; }, 1600);
  };
  row.append(input, copy);
  box.append(head, row, el("p", "Whoever opens this link can take one seat. Send it only to the person you are inviting.", "cv-note"));
  return box;
}

// ---------- removal ----------
// Own seat: leave at once. Another seat: open a vote among the other seats.
export async function revokeSeat({ world, identity, seat, fb }) {
  const self = identity?.seat === seat;
  if (!world.configured && !identity?.nullifier) { fb.set("Pick a demo identity under Act as first.", "bad"); return { ok: false, status: 0, data: {} }; }
  fb.set(world.configured ? "Preparing the World ID proof…" : self ? `Leaving the council as ${seat} (DEMO)…` : `Proposing to remove ${seat} as ${identity.seat} (DEMO)…`, "wait");
  try {
    const res = world.configured
      ? await runWorldRevoke({ seat, onQr: (_u, svg) => fb.qr(svg), onStatus: (t) => fb.set(t, "wait") })
      : await api.revoke({ mocked: true, byNullifier: identity.nullifier, seat });
    if (res.ok && res.data.voteOpened) {
      emit("council:removal-proposed", res.data);
      fb.set(`Removal vote ${res.data.subject} opened: ${res.data.vote.needed} of the ${res.data.vote.eligible.length} other seat${res.data.vote.eligible.length === 1 ? "" : "s"} must vote yes to remove ${seat}.`, "ok");
    } else if (res.ok) {
      emit("council:revoked", res.data);
      fb.set(`${res.data.seat} left the council. Epoch ${res.data.epoch}; ${res.data.cancelledProposals.length} pending proposal(s) cancelled.`, "ok");
    } else if (!fb.needKey(res)) fb.set(res.data?.error || "The council did not accept this.", "bad");
    return res;
  } catch {
    fb.set("Could not reach the server. Try again.", "bad");
    return { ok: false, status: 0, data: {} };
  } finally { fb.clearQr(); }
}

// ---------- ballots ----------
export async function castBallot({ item, choice, world, identity, fb }) {
  fb.set(world.configured ? "Preparing the World ID ballot…" : `Recording a ${choice.toUpperCase()} ballot as ${identity?.seat ?? "?"} (DEMO)…`, "wait");
  try {
    let res;
    if (world.configured) res = await runWorldBallot({ kind: item.kind, subject: item.subject, choice, onQr: (_u, svg) => fb.qr(svg), onStatus: (t) => fb.set(t, "wait") });
    else if (!world.mockedAllowed) res = { ok: false, status: 0, data: { error: "World ID is not configured here and demo identities are disabled." } };
    else if (!identity?.nullifier) res = { ok: false, status: 0, data: { error: "Pick a demo identity under Act as, or join the council first." } };
    else {
      res = await api.vote(item.kind, item.subject, { choice, mocked: true, byNullifier: identity.nullifier });
      if (res.ok) emit("council:ballot", { kind: item.kind, subject: item.subject, choice, source: "mocked", ...res.data });
    }
    if (res.ok) {
      const v = res.data.vote;
      const removal = item.kind === "revocation" && v && v.status !== "open" ? (v.status === "passed" ? ` ${item.target} was removed from the council.` : ` ${item.target} keeps its seat.`) : "";
      fb.set(v && v.status !== "open" ? `Ballot recorded. The vote ${v.status === "passed" ? "passed" : "failed"}: ${v.yes} yes, ${v.no} no.${removal}` : `Ballot recorded: ${choice}.`, "ok");
    } else if (!fb.needKey(res)) fb.set(res.data?.error || "The ballot was not recorded.", "bad");
    return res;
  } catch {
    fb.set("Could not reach the server. Nothing was recorded.", "bad");
    return { ok: false, status: 0, data: {} };
  } finally { fb.clearQr(); }
}

// ---------- pixel seat avatar ----------
const HUES = ["#e23b28", "#1f6f8b", "#1c6b45", "#9a6b15", "#6b3fa0", "#b8432f", "#3b3731"];
export function seatAvatar(seat, { pose = "idle", size = 48 } = {}) {
  const node = el("span", undefined, "council-pet cv-avatar", { "aria-hidden": "true", "data-pose": pose });
  node.style.setProperty("--pet-red", HUES[(seatNumber(seat) - 1 + HUES.length) % HUES.length]);
  node.style.width = node.style.height = `${size}px`;
  node.innerHTML = agentMarkup();
  return node;
}
export const sourceBadge = (source) => el("span", source === "world" ? "World ID" : source === "mocked" ? "MOCKED" : source ?? "unknown", "cv-badge", { "data-source": source ?? "unknown" });

// ---------- tally ----------
// Bar: yes grows from the left, no from the right, a mark at `needed`. Reuses its nodes so a poll animates the change.
export function renderTally(host, vote) {
  const total = Math.max(1, vote.eligible.length);
  let bar = host.querySelector(".cv-tally");
  const fresh = !bar;
  if (fresh) {
    bar = el("div", undefined, "cv-tally");
    const track = el("div", undefined, "cv-track", { role: "img" });
    track.append(el("i", undefined, "cv-yes"), el("i", undefined, "cv-no"), el("b", undefined, "cv-need"));
    bar.append(track, el("p", undefined, "cv-nums", { "aria-live": "polite" }));
    host.append(bar);
  }
  bar.dataset.status = vote.status;
  const track = bar.querySelector(".cv-track");
  const yes = bar.querySelector(".cv-yes"), no = bar.querySelector(".cv-no");
  track.setAttribute("aria-label", `${vote.yes} yes and ${vote.no} no of ${vote.eligible.length} eligible; ${vote.needed} needed`);
  bar.querySelector(".cv-need").style.left = `${(vote.needed / total) * 100}%`;
  const apply = () => { yes.style.width = `${(vote.yes / total) * 100}%`; no.style.width = `${(vote.no / total) * 100}%`; };
  if (fresh && !reduced()) { yes.style.width = no.style.width = "0%"; requestAnimationFrame(() => requestAnimationFrame(apply)); } else apply();
  const nums = bar.querySelector(".cv-nums");
  const state = vote.status === "passed" ? "Passed" : vote.status === "failed" ? "Failed" : `${Math.max(0, vote.needed - vote.yes)} more yes to pass`;
  const text = `${vote.yes} yes · ${vote.no} no · ${vote.needed} of ${vote.eligible.length} needed · ${state}`;
  if (nums.textContent !== text) {
    nums.replaceChildren(el("b", String(vote.yes), "cv-y"), ` yes · `, el("b", String(vote.no), "cv-n"), ` no · ${vote.needed} of ${vote.eligible.length} needed · `, el("span", state, "cv-state"));
    if (!fresh) replay(nums, "cv-bump");
  }
  return bar;
}

// ---------- decision wording ----------
// PENDING_VOTE and PENDING_CHALLENGE are waiting states, never refusals.
export function decisionLabel(decision) {
  switch (decision) {
    case "SIGNED": return { label: "Signed", tone: "safe" };
    case "REFUSED": return { label: "Refused", tone: "danger" };
    case "CANCELLED": return { label: "Cancelled", tone: "danger" };
    case "PENDING_CHALLENGE": return { label: "Challenge window", tone: "warn" };
    case "PENDING_VOTE": return { label: "Waiting for the council", tone: "warn" };
    default: return { label: decision ? decision.toLowerCase() : "not decided", tone: "neutral" };
  }
}
export const pill = (tone, label) => el("span", label, "cv-pill", { "data-tone": tone });
export const kindLabel = (kind) => (kind === "mandate" ? "Standing instruction" : kind === "revocation" ? "Removal vote" : "Payment");
// What a closed vote did, per kind.
export function resultLabel(item) {
  if (item.kind === "revocation") {
    // A ballot response carries the tally before the list shows the new decision.
    if (item.decision === "removed" || (item.decision === "open" && item.vote.status === "passed")) return { label: "Seat removed", tone: "danger" };
    if (item.decision === "kept" || (item.decision === "open" && item.vote.status === "failed")) return { label: "Seat kept", tone: "safe" };
    return { label: item.decision === "cancelled" ? "Cancelled" : "Open", tone: "neutral" };
  }
  if (item.kind === "proposal" && item.decision) return decisionLabel(item.decision);
  return item.vote.status === "passed" || item.decision === "adopted" || item.decision === "superseded" ? { label: "Adopted", tone: "safe" } : { label: "Rejected", tone: "danger" };
}

// ---------- vote card ----------
// ctx: { world, identity, onVote(item, choice, card), detail?(item) -> Node | null }
export function voteCard(item, ctx) {
  const card = el("article", undefined, "cv-card", { "data-subject": item.subject, "data-kind": item.kind, "aria-label": `${item.kind === "mandate" ? "Instruction" : item.kind === "revocation" ? "Removal" : "Payment"} vote ${item.subject}` });
  const head = el("header", undefined, "cv-card-head");
  const folio = el("span", `${kindLabel(item.kind)} · ${item.subject}`, "doc-folio");
  head.append(folio, el("span", undefined, "cv-card-pet"));
  head.lastChild.append(seatAvatar(item.kind === "revocation" ? item.target : `seat:${item.kind === "mandate" ? 1 : 4}`, { size: 34 }));
  card.append(head, el("h3", item.title, "cv-card-title"));
  if (item.kind === "proposal" && item.amountTinybars !== undefined) {
    const line = el("p", undefined, "cv-amount");
    line.append(el("b", hbar(item.amountTinybars)), " to ", el("code", item.payee ?? "?"));
    card.append(line);
  }
  const why = el("div", undefined, "cv-why");
  if (item.kind === "revocation") {
    why.append(el("span", "Why it is a vote", "doc-folio"));
    const list = el("ul", undefined, "cv-violations");
    (item.summary?.length ? item.summary : [`Removing ${item.target} needs a majority of the other seats.`]).forEach((v) => list.append(el("li", v)));
    why.append(list);
  } else if (item.kind === "proposal") {
    why.append(el("span", "Why it needs the council", "doc-folio"));
    const list = el("ul", undefined, "cv-violations");
    (item.violations?.length ? item.violations : ["Outside the standing instruction."]).forEach((v) => list.append(el("li", v)));
    why.append(list);
  } else {
    why.append(el("span", "Adopting these rules", "doc-folio"));
    const extra = ctx.detail?.(item);
    why.append(extra ?? el("p", "The owner's instruction compiled into rules. Once adopted, payments inside them are signed with no vote.", "cv-muted"));
  }
  card.append(why, el("div", undefined, "cv-tally-host"), el("ul", undefined, "cv-ballots", { "aria-label": "Ballots cast" }), el("div", undefined, "cv-actions"));
  const stamp = el("div", undefined, "cv-stamp", { "aria-hidden": "true" }); stamp.hidden = true;
  card.append(stamp);
  updateVoteCard(card, item, ctx);
  return card;
}

export function updateVoteCard(card, item, ctx) {
  const vote = item.vote;
  card.dataset.status = vote.status;
  renderTally(card.querySelector(".cv-tally-host"), vote);
  card.querySelector(".cv-ballots").replaceChildren(...vote.ballots.map((b) => {
    const li = el("li", undefined, "cv-ballot", { "data-choice": b.choice, title: `${b.seat} voted ${b.choice} (${b.source}) at ${when(b.at)}` });
    li.append(el("span", b.choice === "yes" ? "✓" : "✕", "cv-mark", { "aria-hidden": "true" }), `${b.seat.replace("council-seat:", "seat ")} ${b.choice}`);
    return li;
  }));
  const actions = card.querySelector(".cv-actions");
  actions.replaceChildren();
  // A revocation can close a vote without a result (cancelled, or an instruction draft rejected).
  const closedEarly = item.kind !== "proposal" && item.decision && item.decision !== "open";
  if (vote.status !== "open" || closedEarly) {
    const result = resultLabel(item);
    const head = vote.status === "passed" ? pill("safe", "Vote passed") : vote.status === "failed" ? pill("danger", "Vote failed") : pill("neutral", "Vote closed");
    actions.append(head, pill(result.tone, result.label));
    if (vote.status !== "open") showStamp(card, vote.status === "passed", false);
    return;
  }
  const { world, identity } = ctx;
  if (ctx.readOnly) {
    actions.append(el("span", ctx.readOnly, "cv-note"));
    return;
  }
  const mine = identity ? vote.ballots.find((b) => b.seat === identity.seat) : null;
  const eligible = identity ? vote.eligible.includes(identity.seat) : false;
  let note = "";
  let disabled = false;
  if (mine) { disabled = true; note = `${identity.seat} voted ${mine.choice}.`; }
  else if (item.kind === "revocation" && identity?.seat === item.target) { disabled = true; note = `This vote is about ${identity.seat}: the other seats decide.`; }
  else if (world.configured) note = identity ? `Prove with World ID as ${identity.seat}.` : "Your World ID proof is matched to your seat.";
  else if (!world.mockedAllowed) { disabled = true; note = "World ID is not configured on this server."; }
  else if (!identity) { disabled = true; note = "Join, or pick a DEMO identity under Act as."; }
  else if (!eligible) { disabled = true; note = `${identity.seat} joined after this vote opened, so it cannot vote on it.`; }
  else note = `Voting as ${identity.seat} (DEMO).`;
  for (const choice of ["yes", "no"]) {
    const b = el("button", choice === "yes" ? "Vote yes" : "Vote no", choice === "yes" ? "btn btn-primary cv-vote" : "btn cv-vote", { type: "button", "data-choice": choice });
    b.disabled = disabled;
    b.onclick = async () => {
      actions.querySelectorAll("button").forEach((x) => { x.disabled = true; });
      try { await ctx.onVote(item, choice, card); } finally { if (card.isConnected && card.dataset.status === "open") actions.querySelectorAll("button").forEach((x) => { x.disabled = disabled; }); }
    };
    actions.append(b);
  }
  actions.append(el("span", note, "cv-note"));
}

// "Passed" / "Refused" stamp, and the card's courier hops or stops.
export function showStamp(card, passed, animate = true) {
  const stamp = card.querySelector(".cv-stamp");
  const kind = card.dataset.kind;
  const label = kind === "mandate" ? (passed ? "Adopted" : "Rejected") : kind === "revocation" ? (passed ? "Removed" : "Kept") : (passed ? "Passed" : "Refused");
  const already = !stamp.hidden && stamp.textContent === label;
  stamp.hidden = false; stamp.textContent = label; stamp.dataset.result = passed ? "passed" : "failed";
  const pet = card.querySelector(".cv-card-pet .council-pet");
  if (pet) pet.dataset.pose = passed ? "signed" : "refused";
  if (animate && !already && !reduced()) {
    // m-reveal keeps opacity 0 without its animation; drop it before another animation replaces it.
    card.classList.remove("m-reveal");
    replay(stamp, "m-slam", 0);
    replay(card, passed ? "m-flash-green" : "m-flash-red", 0);
  }
}

// ---------- identity bar ("Act as") ----------
// Renders the DEMO banner + picker, or the World ID note, plus Join and Invite buttons. Calls onChange(identity) on every change.
// invite: a code from an invite link (?invite=), used by the next join.
export function mountIdentityBar(host, { world, fb, onChange = () => {}, invite = null }) {
  let pending = invite;      // invite code from the link, until it is used
  let issued = null;         // the last invite this browser issued, shown until the identity changes
  const doJoin = async (btn) => {
    btn.disabled = true;
    try {
      const r = await joinCouncil({ world, fb, invite: pending, autoInvite: !pending });
      if (r.ok) {
        const used = Boolean(pending);
        pending = null; issued = null;
        render();
        onChange(identities.current(), { joined: r.data.seat, usedInvite: used });
      }
    } finally { btn.disabled = false; }
  };
  const doInvite = async (btn) => {
    btn.disabled = true;
    try {
      const r = await createInvite({ world, identity: identities.current(), fb });
      if (r.ok) { issued = r.data; render(); }
    } finally { btn.disabled = false; }
  };
  const inviteNote = () => {
    const note = el("p", undefined, "cv-invite-note", { role: "note" });
    note.append(el("b", "Invited"), ` You have a single-use invite (${short(pending, 6)}). Join to take your seat; it is spent when you do.`);
    return note;
  };
  const render = () => {
    const list = identities.list();
    const current = identities.current();
    host.replaceChildren();
    host.className = "cv-identity";
    host.dataset.mode = world.configured ? "world" : world.mockedAllowed ? "demo" : "off";
    if (isDemo(world)) {
      const banner = el("p", undefined, "cv-demo-banner", { role: "note" });
      banner.append(el("b", "DEMO identities"), " These seats are MOCKED World ID proofs kept in this browser, so one person can play several voters. Not real proofs. New members join with an invite: Add a demo member issues one as the identity you act as.");
      host.append(banner);
      if (pending) host.append(inviteNote());
      const row = el("div", undefined, "cv-identity-row");
      const label = el("label", undefined, "cv-actas");
      label.append(el("span", "Act as", "doc-folio"));
      const select = el("select", undefined, "cv-select", { id: "actAs" });
      if (!list.length) select.append(el("option", "No demo identity yet", undefined, { value: "" }));
      list.forEach((x) => select.append(el("option", `${x.seat}${x.source === "world" ? " (World ID)" : " · DEMO"}`, undefined, { value: x.seat })));
      select.value = current?.seat ?? "";
      select.disabled = !list.length;
      select.onchange = () => { identities.use(select.value); issued = null; render(); onChange(identities.current()); };
      label.append(select);
      row.append(label);
      if (current) { const a = el("a", "Open my seat", "btn", { href: `/member.html?seat=${encodeURIComponent(current.seat)}` }); row.append(a); }
      const join = el("button", pending ? "Join with this invite" : list.length ? "Add a demo member" : "Join as a demo member", pending ? "btn btn-primary" : "btn", { type: "button", id: "join-btn" });
      join.onclick = () => doJoin(join);
      row.append(join);
      if (current?.nullifier) {
        const inv = el("button", "Invite a member", "btn", { type: "button", id: "invite-btn" });
        inv.onclick = () => doInvite(inv);
        row.append(inv);
      }
      host.append(row);
    } else if (world.configured) {
      const note = el("p", undefined, "cv-world-note");
      note.append(el("b", "World ID"), " Every ballot is a fresh World ID proof from a seat holder, bound to the exact proposal or rules and to your choice. The first seat founds the council; everyone after needs an invite from a seat holder.");
      host.append(note);
      if (pending) host.append(inviteNote());
      const row = el("div", undefined, "cv-identity-row");
      const join = el("button", pending ? "Join with this invite (World ID)" : "Join the council (World ID)", pending ? "btn btn-primary" : "btn", { type: "button", id: "join-btn" });
      join.onclick = () => doJoin(join);
      row.append(join);
      if (current) {
        row.append(el("a", `My seat: ${current.seat}`, "btn", { href: `/member.html?seat=${encodeURIComponent(current.seat)}` }));
        const inv = el("button", "Invite a member", "btn", { type: "button", id: "invite-btn" });
        inv.onclick = () => doInvite(inv);
        row.append(inv);
      }
      host.append(row);
    } else {
      host.append(el("p", "World ID is not configured on this server and demo identities are disabled, so this browser cannot vote.", "cv-world-note"));
    }
    if (issued) host.append(invitePanel(issued));
  };
  render();
  return {
    render,
    // Re-render only when a stored identity vanished, so polling never resets the picker under the user's hand.
    prune(ids) { const before = identities.list().length; if (identities.prune(ids).length !== before) { render(); return true; } return false; },
  };
}

// ---------- polling ----------
// Runs fn now and every ms while the tab is visible; never overlaps.
export function poll(fn, ms) {
  let busy = false;
  const tick = async () => { if (busy || document.hidden) return; busy = true; try { await fn(); } catch { /* next tick retries */ } finally { busy = false; } };
  const id = setInterval(tick, ms);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  return { tick, stop: () => clearInterval(id) };
}

// Header chain tag, rail and footer, as on the console.
export async function fillChrome() {
  const [h, pol] = await Promise.all([
    api.health().then((r) => (r.ok ? r.data : null)).catch(() => null),
    fetch("/policy").then((r) => r.json()).catch(() => ({})),
  ]);
  if (!h) return null;
  const tag = `${h.mode}, ${h.network}`;
  for (const id of ["chainTag", "railMode"]) { const n = $(id); if (n) n.textContent = tag; }
  const left = $("footLeft"), right = $("footRight");
  if (left) left.textContent = `Council Agent, Mumbai 2026, policy ${pol.hash ? `${pol.hash.slice(0, 12)}…` : "n/a"}`;
  if (right) right.textContent = `${h.councilSeats} seat${h.councilSeats === 1 ? "" : "s"}, World ${String(h.world).startsWith("real") ? "real" : "mocked"}, 0G ${h.zeroG}`;
  return h;
}
