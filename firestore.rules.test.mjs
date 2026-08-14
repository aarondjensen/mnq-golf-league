// ══════════════════════════════════════════════════════════════════
//  firestore.rules — the tests
// ══════════════════════════════════════════════════════════════════
//
// The rules are the only thing between a stranger holding the app's public
// config and the league's data, so "it reads correctly" is not good enough.
// Bourbon Cup and WBC have both had a suite like this for a while; MnQ was the
// one of the three without, which made it the one place a permissions mistake
// had no way of being caught before it reached a phone.
//
// Run it before deploying a rules change:
//
//   npm i --no-save firebase-tools @firebase/rules-unit-testing
//   npx firebase emulators:exec --only firestore --project mnq-rules-probe \
//     "node firestore.rules.test.mjs"
//
// The two packages are deliberately NOT devDependencies: ~600 packages and a
// JVM emulator between them, needed by whoever is editing the rules and nobody
// else. `--no-save` leaves package.json alone.
//
// Everything runs against a throwaway project id on a local emulator. No call
// in here can reach the real league.
//
// ── What this is actually guarding ──
// Three properties, and the third is the one that would be easy to lose:
//
//   1. A stranger with a Firebase token but no member doc can read but not
//      write. Reads are open to any signed-in user on purpose — JoinScreen
//      has to list players and read the invite code BEFORE the user has a
//      member doc — so "signed in" is not "trusted", and every write path
//      has to say so separately.
//   2. Nobody can promote themselves. isCommissioner lives on a member doc
//      the member themselves can write, which is exactly the shape that
//      leaks a crown if the rule is written carelessly.
//   3. Fun rounds have a SPLIT write: the commissioner owns the round, any
//      member owns the tee sheet. That is the only field-level rule in the
//      file, and a change that relaxed it into a plain isMember() write
//      would let a member move a tee time the commissioner booked with the
//      pro shop — while every screen still looked right.
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, getDocs, collection, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "mnq-rules-probe",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e?.message?.slice(0, 140)]); }
};

// The league id is baked into the member doc id by the rules themselves
// (`league_2026_<uid>`), and it has to match LEAGUE_ID in src/firebase.js.
// Spelling it once here means a mismatch shows up as a wall of failures
// rather than as one confusing one.
const LEAGUE_ID = "league_2026";
const memberDoc = (uid) => `league_members/${LEAGUE_ID}_${uid}`;

// carol is the commissioner, pete an ordinary member, mallory signed in with
// no member doc at all, and anon has no token.
//
// frank and nomad exist because this file MUTATES roles as it goes: pete gets
// promoted in the escalation section, and mallory joins. Reusing either one
// afterwards asserts against a role they no longer hold — which is exactly
// what the first run of this suite did, passing five assertions that were
// testing nothing. frank stays a plain member to the end; nomad never joins.
const carolDb = () => env.authenticatedContext("carol").firestore();
const peteDb = () => env.authenticatedContext("pete").firestore();
const malloryDb = () => env.authenticatedContext("mallory").firestore();
const frankDb = () => env.authenticatedContext("frank").firestore();
const nomadDb = () => env.authenticatedContext("nomad").firestore();
const anonDb = () => env.unauthenticatedContext().firestore();

const seed = (path, data) => env.withSecurityRulesDisabled(ctx =>
  setDoc(doc(ctx.firestore(), path), data));

await env.clearFirestore();

// The commissioner is created the only way one can be — out of band, with
// rules disabled, exactly as a human editing the doc in the Firebase console.
// The rules cannot express "first user bootstraps as commissioner" (they
// cannot check that a collection is empty), which is why this is the
// documented bootstrap and why the test has to do it this way too.
await seed(memberDoc("carol"), { uid: "carol", isCommissioner: true });
await seed(memberDoc("pete"), { uid: "pete" });
await seed(memberDoc("frank"), { uid: "frank" });

// ── Anonymous: nothing, in either direction ────────────────────────
await check("anon cannot read the roster", () =>
  assertFails(getDocs(collection(anonDb(), "league_players"))));

await check("anon cannot write a score", () =>
  assertFails(setDoc(doc(anonDb(), "league_hole_scores/x"), { v: 4 })));

await check("anon cannot join by writing themselves a member doc", () =>
  assertFails(setDoc(doc(anonDb(), memberDoc("anon")), { uid: "anon" })));

// ── Signed in but not a member: reads only ─────────────────────────
// This is the join flow's requirement, and it is why every write rule has to
// state its own gate: `signedIn()` is deliberately weak.
await check("a signed-in stranger can read the roster (JoinScreen needs it)", () =>
  assertSucceeds(getDocs(collection(malloryDb(), "league_players"))));

await check("a signed-in stranger can read the config (the invite code lives there)", () =>
  assertSucceeds(getDoc(doc(malloryDb(), "league_config/main"))));

await check("a signed-in stranger cannot write a score", () =>
  assertFails(setDoc(doc(malloryDb(), "league_hole_scores/x"), { v: 4 })));

await check("a signed-in stranger cannot write a match result", () =>
  assertFails(setDoc(doc(malloryDb(), "league_match_results/x"), { week: 1 })));

await check("a signed-in stranger cannot register a push token", () =>
  assertFails(setDoc(doc(malloryDb(), "league_notifications_tokens/x"), { token: "t" })));

// ── A member can play golf ─────────────────────────────────────────
// Everything a phone does on league night. If one of these inverts, a rules
// deploy is about to eat scores on a tee box.
await check("a member can post a hole score", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_hole_scores/w1_pete_h1"), { v: 4 })));

await check("a member can write a match result (finalize / attest / auto-heal)", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_match_results/w1_m1"), { week: 1 })));

await check("a member can write a group result", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_group_results/w1_g1"), { week: 1 })));

await check("a member can claim a CTP", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_ctp/w1_h7"), { playerId: "p1" })));

await check("a member can mark attendance, including a teammate's", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_attendance/w1_p2"), { status: "in" })));

await check("a member can delete an attendance row (status=null deletes)", async () => {
  await seed("league_attendance/w1_p3", { status: "in" });
  await assertSucceeds(deleteDoc(doc(peteDb(), "league_attendance/w1_p3")));
});

await check("a member can unsign — the delete path on a match result", async () => {
  await seed("league_match_results/w2_m1", { week: 2 });
  await assertSucceeds(deleteDoc(doc(peteDb(), "league_match_results/w2_m1")));
});

await check("a member can register their own push token", () =>
  assertSucceeds(setDoc(doc(peteDb(), "league_notifications_tokens/pete_dev1"), { token: "t" })));

// ── A member is not a commissioner ─────────────────────────────────
// The whole admin surface, asserted collection by collection. A single
// `allow write: if isMember()` pasted onto any of these would hand the league
// to anybody who ever joined it.
await check("a member cannot touch the roster, teams, schedule, config, course or scoring", async () => {
  await assertFails(setDoc(doc(peteDb(), "league_players/p9"), { name: "Ringer" }));
  await assertFails(setDoc(doc(peteDb(), "league_teams/t9"), { name: "Ringers" }));
  await assertFails(setDoc(doc(peteDb(), "league_schedule/w9"), { week: 9 }));
  await assertFails(setDoc(doc(peteDb(), "league_config/main"), { inviteCode: "letmein" }));
  await assertFails(setDoc(doc(peteDb(), "league_course/main"), { par: 36 }));
  await assertFails(setDoc(doc(peteDb(), "league_scoring/main"), { recentN: 1 }));
});

await check("the commissioner can", async () => {
  await assertSucceeds(setDoc(doc(carolDb(), "league_players/p9"), { name: "Real Player" }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_teams/t9"), { name: "Real Team" }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_schedule/w9"), { week: 9 }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_config/main"), { inviteCode: "real" }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_course/main"), { par: 36 }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_scoring/main"), { recentN: 5 }));
});

// ── Nobody promotes themselves ─────────────────────────────────────
// isCommissioner lives on a doc its own subject is allowed to write, which is
// precisely the shape that leaks a crown if the rule is written carelessly.
await check("a new member cannot arrive already wearing the crown", () =>
  assertFails(setDoc(doc(malloryDb(), memberDoc("mallory")),
    { uid: "mallory", isCommissioner: true })));

await check("but they can join normally", () =>
  assertSucceeds(setDoc(doc(malloryDb(), memberDoc("mallory")), { uid: "mallory" })));

await check("an existing member cannot promote themselves later", () =>
  assertFails(setDoc(doc(peteDb(), memberDoc("pete")),
    { uid: "pete", isCommissioner: true }, { merge: true })));

await check("a member cannot write somebody else's member doc", () =>
  assertFails(setDoc(doc(peteDb(), memberDoc("carol")), { uid: "carol" }, { merge: true })));

await check("a member cannot claim another uid inside their own doc id", () =>
  assertFails(setDoc(doc(peteDb(), memberDoc("pete")), { uid: "carol" }, { merge: true })));

await check("the commissioner can promote somebody", () =>
  assertSucceeds(setDoc(doc(carolDb(), memberDoc("pete")),
    { uid: "pete", isCommissioner: true }, { merge: true })));

await check("a commissioner keeps the crown when they update their own doc", () =>
  // The rule permits isCommissioner:true through an update only when it was
  // ALREADY true — otherwise a commissioner editing their own row would have
  // to strip their own flag to save.
  assertSucceeds(setDoc(doc(carolDb(), memberDoc("carol")),
    { uid: "carol", isCommissioner: true, name: "Carol" }, { merge: true })));

await check("a member can delete their own membership (in-app account deletion)", async () => {
  await seed(memberDoc("dave"), { uid: "dave" });
  const daveDb = env.authenticatedContext("dave").firestore();
  await assertFails(deleteDoc(doc(daveDb, memberDoc("pete"))));
  await assertSucceeds(deleteDoc(doc(daveDb, memberDoc("dave"))));
});

// ── Fun rounds: the split write ────────────────────────────────────
// The only field-level rule in the file, and the one most likely to be
// "simplified" into a plain isMember() write by somebody who reads the
// collection name and assumes it is casual therefore unimportant. It is not:
// the commissioner is the one who booked the tee times.
await seed("league_fun_rounds/fr1", {
  id: "fr1", league_id: LEAGUE_ID, date: "2026-06-01", startTime: "17:00",
  groupCount: 2, groupSize: 4, slots: {}, guests: {},
});

await check("only the commissioner creates or deletes a fun round", async () => {
  await assertFails(setDoc(doc(frankDb(), "league_fun_rounds/fr2"), { id: "fr2" }));
  await assertSucceeds(setDoc(doc(carolDb(), "league_fun_rounds/fr2"), { id: "fr2" }));
  await assertFails(deleteDoc(doc(frankDb(), "league_fun_rounds/fr2")));
  await assertSucceeds(deleteDoc(doc(carolDb(), "league_fun_rounds/fr2")));
});

await check("a member can claim a tee-time spot", () =>
  assertSucceeds(setDoc(doc(frankDb(), "league_fun_rounds/fr1"),
    { slots: { g0_s2: "p1" } }, { merge: true })));

await check("a member can seat a guest — slots and guests move together", () =>
  // Both keys have to be permitted together or the merge is rejected whole,
  // which is why `guests` is in the hasOnly set beside `slots`.
  assertSucceeds(setDoc(doc(frankDb(), "league_fun_rounds/fr1"),
    { slots: { g0_s3: "guest_1" }, guests: { guest_1: { name: "Friend", hcp: 12 } } },
    { merge: true })));

await check("a member cannot move the tee time the commissioner booked", () =>
  assertFails(setDoc(doc(frankDb(), "league_fun_rounds/fr1"),
    { startTime: "07:00" }, { merge: true })));

await check("a member cannot add a group the course never booked", () =>
  assertFails(setDoc(doc(frankDb(), "league_fun_rounds/fr1"),
    { groupCount: 9 }, { merge: true })));

await check("a member cannot smuggle a date change in alongside a legal claim", () =>
  // The rule is hasOnly, not "contains" — one illegal key poisons the write
  // even when the rest of it is a perfectly ordinary spot claim.
  assertFails(setDoc(doc(frankDb(), "league_fun_rounds/fr1"),
    { slots: { g1_s1: "p2" }, date: "2026-07-04" }, { merge: true })));

await check("the commissioner can change the round itself", () =>
  assertSucceeds(setDoc(doc(carolDb(), "league_fun_rounds/fr1"),
    { startTime: "16:30", groupCount: 3 }, { merge: true })));

await check("fun-round scorecards are a plain member write", async () => {
  await assertFails(setDoc(doc(nomadDb(), "league_fun_scores/fr1_p1"), { h1: 4 }));
  await assertSucceeds(setDoc(doc(frankDb(), "league_fun_scores/fr1_p1"), { h1: 4 }));
  await assertSucceeds(deleteDoc(doc(frankDb(), "league_fun_scores/fr1_p1")));
});

// ── The default deny ───────────────────────────────────────────────
// Stated explicitly at the bottom of the rules file; asserted here so that a
// collection added to the app without a matching rule fails loudly in a test
// rather than quietly on a phone.
await check("an unknown collection is denied to everybody, commissioner included", async () => {
  await assertFails(getDoc(doc(frankDb(), "league_something_new/x")));
  await assertFails(setDoc(doc(carolDb(), "league_something_new/x"), { v: 1 }));
});

await env.cleanup();

let failed = 0;
for (const [status, name, msg] of results) {
  if (status === "FAIL") failed++;
  console.log(`${status}  ${name}${msg ? `\n      ${msg}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
