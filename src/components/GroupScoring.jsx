// ══════════════════════════════════════════════════════════════════
//  GroupScoring — hole-by-hole scoring for a foursome with no match
// ══════════════════════════════════════════════════════════════════
//
// Extracted from pages/Scoring.jsx so it can serve TWO callers:
//
//   • Scoring   → a playoff individual group (a team knocked out of the
//                 bracket, regrouped into a foursome)
//   • FunRounds → a fun-round tee group
//
// Both are the same situation — golfers sharing a tee time with no
// opponent and no match status — so they get the identical screen, the
// identical scoring gesture, and the identical hole strip. It lives
// here rather than in Scoring.jsx because Scoring.jsx imports
// FunRounds, and FunRounds importing back would be a cycle.
//
// Where the scores LIVE is the only real difference, and it's injected:
// pass a `scoreStore` of { get(pid, hole), set(pid, hole, value) } and
// this component neither knows nor cares whether that's a league week's
// hole_scores or a fun round's card. Omit it and the week-keyed store
// is used, which is exactly what the playoff caller wants — so that
// caller's behavior is unchanged by the extraction.
//
// Two features are optional because they are league-only:
//   • allowAttendance — Absent / Making Up. A fun round has no league
//     week to be absent from.
//   • allowSigning    — Sign / Attest. Nothing here feeds a competition,
//     so there is nothing to vouch for.

import { useState, useEffect, useRef } from "react";
import { K, Card, BackBtn, FS, FW, IND_WITHDRAW, indivGroupResultId, resolveIndivRound } from "../theme";
import { LEAGUE_ID } from "../firebase";
import { buildStrokesMap } from "../lib/matchCalc";
import { computeRoundLine } from "../lib/indivGroups";
import { SharedScorecard } from "./SharedScorecard";
import { ConfirmModal } from "./Popup";

// Score-relative-to-par labels for the entry buttons. Lives here with
// PlayerScoreCard, the only thing that renders them.
const SCORE_LABELS = ["Birdie", "Par", "Bogey", "Double", "Triple"];

// ──────────────────────────────────────────────────────────────────────────
//  ScoringToast — the fixed-position confirmation toast
// ──────────────────────────────────────────────────────────────────────────
// Extracted so views that return early (the individual-group view) render the
// same toast as the match view. Toast state lives in LiveScoringView, but each
// view owns its own return, so the markup has to travel with them.
export function ScoringToast({ toast, animate = false }) {
  if (!toast) return null;
  return (<>
    {animate && <style>{`@keyframes toastDown { 0% { transform: translateX(-50%) translateY(-20px); opacity: 0; } 100% { transform: translateX(-50%) translateY(0); opacity: 1; } }`}</style>}
    <div style={{ position: "fixed", top: 30, left: "50%", transform: "translateX(-50%)", background: K.act, color: K.bg, padding: "12px 48px", borderRadius: 12, fontSize: FS.sm, fontWeight: FW.bold, zIndex: 1000, whiteSpace: "nowrap", minWidth: 240, textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.4)", ...(animate ? { animation: "toastDown 0.3s ease" } : {}) }}>
      {toast}
    </div>
  </>);
}

// ═══════════════════════════════════════════════════════════════
//  IndivGroupScoring — scoring for a playoff individual group
// ═══════════════════════════════════════════════════════════════
//
// Once a team is knocked out of the bracket, its players are regrouped into an
// individual foursome (lib/indivGroups.js). There is no match: no opponent, no
// hole-by-hole match status, no Sign Scorecard, no attestation, and no
// match_result document. Four golfers share a tee time and each posts an
// individual net round for the individual tournament.
//
// So this view is deliberately NOT the match view with parts hidden. It keeps
// only what applies: the hole strip, the per-hole entry cards (the same
// PlayerScoreCard the match view uses, so the scoring gesture is identical),
// and a full-round scorecard. Scores are written to the same
// `w{week}_p{pid}_h{hole}` keys, which is what the individual leaderboard,
// the Low Net board, Stats and the handicap calc all read — nothing
// downstream needs to know the round came from a group rather than a match.
//
// Absent-substitution (a present teammate covering both slots) is deliberately
// NOT applied here: it is a team rule, and there is no team. A golfer who
// doesn't play simply has no round, which resolveIndivRound already reports as
// mode "none".
export function GroupScoring({
  pids, week, side, pars, hcps, playerMap, holeScores, saveScore,
  isWeekLocked, viewerPid, onBack, header, toast, setToast,
  attendance, saveAttendance,
  groupMatch, groupResult, saveGroupResult, deleteGroupResult, isComm,
  // Injected store — see the file header. Omitted by the playoff caller,
  // which keeps the week-keyed behavior this component was born with.
  scoreStore,
  allowAttendance = true,
  allowSigning = true,
  // Optional (pid) => `ir`, the resolved round the net summary reads.
  // The default understands the week store's makeup and total-only
  // namespaces, which a plain per-hole read would silently drop — so
  // the playoff caller must keep it.
  resolveRound,
}) {
  const [curHole, setCurHole] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmUnsign, setConfirmUnsign] = useState(false);
  // Own confirm state: this view returns before the parent renders its
  // ConfirmModal, so it needs its own instance of the shared component.
  const [groupConfirm, setGroupConfirm] = useState(null);

  const getScore = (pid, h) =>
    scoreStore ? (scoreStore.get(pid, h) || 0) : (holeScores[`w${week}_p${pid}_h${h}`] || 0);
  const resolveFor = resolveRound || ((pid) => resolveIndivRound(holeScores, week, pid));
  const getHcp = (pid) => {
    const p = playerMap[pid];
    return p ? Math.round(p.handicapIndex || 0) : 0;
  };
  const getStrokes = (pid, h) => buildStrokesMap(getHcp(pid), hcps)[h] || 0;
  // ── Attendance within the group ─────────────────────────────────────
  // Anyone in the foursome can flag anyone else — there's no commissioner in
  // the group and no opposing team to arbitrate, so the golfers standing on
  // the tee are the only people who know who showed up.
  //
  // ABSENT is the individual event's withdrawal. A team match handles an
  // absence by having the present teammate cover both slots (`_habsent`);
  // there is no teammate here, so an absent golfer simply has no round, which
  // is exactly what the `_hindivwd` sentinel means. Writing it is what lets
  // the group finish its card and the week finalize — otherwise one no-show
  // pins the group below a complete scorecard forever.
  //
  // MAKING UP means the round happens later, so the golfer drops out of this
  // group's completeness check (the other three can sign tonight) but stays
  // unaccounted for in the finalize pre-flight until their makeup is entered.
  // That's the same treatment the team-match makeup flow gets.
  // Withdrawal is part of the attendance feature — it's the individual
  // event's "didn't play this week". With attendance off there is no week
  // to withdraw from, so nobody ever is.
  const isWithdrawn = (pid) =>
    allowAttendance && holeScores[`w${week}_p${pid}_h${IND_WITHDRAW}`] === 1;
  const attnStatus = (pid) => attendance?.[`w${week}_p${pid}`]?.status || null;
  const isMakingUp = (pid) => attnStatus(pid) === "makeup" && !isWithdrawn(pid);

  const guardAttendance = () => {
    if (!isWeekLocked) return true;
    setToast?.("Week is locked — attendance cannot be changed");
    setTimeout(() => setToast?.(null), 3000);
    return false;
  };

  const markAbsent = (pid) => {
    if (!guardAttendance()) return;
    // Both writes: the sentinel is what the individual event reads, the
    // attendance record is what Schedule's tags and the push notification read.
    saveScore(week, pid, IND_WITHDRAW, 1);
    saveAttendance?.(week, pid, "absent");
  };

  const markMakingUp = (pid) => {
    if (!guardAttendance()) return;
    // Clear any withdrawal — "making up" and "out of the event" are mutually
    // exclusive, and flipping absent → makeup must not leave the golfer
    // silently withdrawn.
    if (isWithdrawn(pid)) saveScore(week, pid, IND_WITHDRAW, 0);
    saveAttendance?.(week, pid, "makeup");
  };

  const clearAttendance = (pid) => {
    if (!guardAttendance()) return;
    if (isWithdrawn(pid)) saveScore(week, pid, IND_WITHDRAW, 0);
    saveAttendance?.(week, pid, null);
  };

  // Same shape PlayerScoreCard's `run` prop expects from the match view.
  const getRunning = (pid) => {
    let gross = 0, net = 0, parTotal = 0, thru = 0;
    for (let h = 0; h < 9; h++) {
      const s = getScore(pid, h);
      if (s > 0) { gross += s; net += s - getStrokes(pid, h); parTotal += pars[h] || 4; thru++; }
    }
    return { gross, net, netVsPar: net - parTotal, thru };
  };

  // scoresLocked is declared below (it depends on the signature state); this
  // reads it at call time, not at definition time, so the ordering is fine.
  const guardedSaveScore = (wk, pid, hole, val) => {
    if (scoresLocked) {
      setToast?.(isWeekLocked
        ? "Week is locked — scores are read-only"
        : "Scorecard attested — unsign it to edit scores");
      setTimeout(() => setToast?.(null), 3000);
      return;
    }
    if (scoreStore) scoreStore.set(pid, hole, val);
    else saveScore(wk, pid, hole, val);
  };

  const par = pars[curHole] || 4;
  const holeHcp = hcps[curHole] || 1;
  const holeLabel = side === 'front' ? curHole + 1 : curHole + 10;

  const getInitials = (pid) => {
    const p = playerMap[pid];
    return p ? p.name.split(' ').map(n => n[0]).join('') : "?";
  };

  // ── Hole navigation parity with the match view ──────────────────────
  // Same two behaviors the team scoring screen has, for the same reason:
  // this is used one-handed on a course. "Live" is the golfers actually
  // playing right now — an absent (withdrawn) or making-up golfer has no card
  // tonight and must not hold the group at hole 1, block the sign button, or
  // be waited on for an attestation.
  const livePids = pids.filter(pid => !isWithdrawn(pid) && !isMakingUp(pid));
  const hasFullRound = (pid) => {
    for (let h = 0; h < 9; h++) if (getScore(pid, h) <= 0) return false;
    return true;
  };
  // Display hole numbers still owed by a golfer, front/back aware — the same
  // "you forgot a hole" list the match view surfaces before signing.
  const missingHolesFor = (pid) => {
    const out = [];
    for (let h = 0; h < 9; h++) if (getScore(pid, h) <= 0) out.push(side === 'front' ? h + 1 : h + 10);
    return out;
  };
  const holeComplete = livePids.length > 0 && livePids.every(pid => getScore(pid, curHole) > 0);
  const allComplete = livePids.length > 0 && livePids.every(hasFullRound);
  const curHoleSig = livePids.map(pid => getScore(pid, curHole)).join(",");

  // Jump to the first unscored hole on the render where scores first arrive
  // (Firestore hasn't answered on mount, so a `[]`-dep effect would miss it).
  const initialJump = useRef(false);
  const firstUnscored = (() => {
    for (let h = 0; h < 9; h++) if (!livePids.every(pid => getScore(pid, h) > 0)) return h;
    return 8;
  })();
  const hasAnyScores = livePids.some(pid => { for (let h = 0; h < 9; h++) if (getScore(pid, h) > 0) return true; return false; });
  useEffect(() => {
    if (initialJump.current) return;
    if (hasAnyScores) {
      if (firstUnscored > 0) setCurHole(firstUnscored);
      initialJump.current = true;
    }
  }, [hasAnyScores, firstUnscored]);

  // Auto-advance once every live card on this hole is in. curHoleSig is a dep
  // so correcting a score inside the 1800ms window restarts the timer instead
  // of letting the original one fire under the edit.
  useEffect(() => {
    if (!holeComplete || curHole >= 8 || allComplete) return;
    const holeNum = side === 'front' ? curHole + 1 : curHole + 10;
    setToast?.(`✓ Hole ${holeNum} saved — advancing...`);
    const timer = setTimeout(() => {
      setToast?.(null);
      setCurHole(prev => {
        let next = prev + 1;
        while (next < 8 && livePids.every(pid => getScore(pid, next) > 0)) next++;
        return next;
      });
    }, 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, curHole, allComplete, curHoleSig]);

  const sc = SharedScorecard({
    pars, side, hcps, team1Pids: pids, team2Pids: [],
    getScore, getStrokes, getHcp, getInitials,
    isAbsent: isWithdrawn,
    holeResults: null, runningStatus: null, clinchHole: null, clinchText: null,
    variant: "allMatches", showTotals: true, showMatchRow: false,
  });

  // ── Signature + attestation ─────────────────────────────────────────
  // Same integrity model as a match scorecard: one golfer signs, the others
  // attest. The individual tournament is scored off these cards, so they get
  // the same verification a bracket match's card gets before the week locks.
  //
  // Withdrawn golfers are excluded from the attester list — they have no round
  // to vouch for, and waiting on them would deadlock the group.
  const isSigned = !!groupResult;
  const signedByPlayerId = groupResult?.signedByPlayerId || null;
  const attestedBy = groupResult?.attestedBy || [];

  // ── Which rounds does the signature actually cover? ──────────────────
  // `roundPids` records the golfers whose cards were on the scorecard at the
  // moment it was signed. It exists because a golfer can join the card AFTER
  // it is signed: the common case is an absence undone days later so a makeup
  // round can be posted. That golfer owes the card a ROUND, not an
  // attestation — they weren't there for the round they'd be vouching for.
  // Prompting them to attest the moment they undo their absence (which is
  // what happened before this field existed) is nonsense, and it also lets a
  // card with an outstanding round read as fully attested.
  //
  // Cards signed before `roundPids` shipped infer it: signing required every
  // live golfer to hold a full round, so whoever holds one now was covered.
  // If NOBODY holds a full round the inference is meaningless — that's scores
  // not loaded yet, not four late golfers — so fall back to "everyone", which
  // is exactly the pre-`roundPids` behavior.
  const inferredCoveredPids = livePids.filter(hasFullRound);
  const coveredPids = Array.isArray(groupResult?.roundPids)
    ? groupResult.roundPids
    : (inferredCoveredPids.length > 0 ? inferredCoveredPids : livePids);
  // Back in the event, but not on the signed card. Withdrawn and making-up
  // golfers are already out of livePids, so this is precisely the
  // "undid an absence to post a makeup" case.
  const latePids = isSigned ? livePids.filter(pid => !coveredPids.includes(pid)) : [];
  const attesterPids = livePids.filter(pid => pid !== signedByPlayerId && coveredPids.includes(pid));
  // An outstanding round keeps the card open just as an outstanding
  // attestation does — otherwise the card locks (scoresLocked) before the
  // makeup golfer can enter the very scores everyone is waiting on.
  const isFullyAttested = isSigned && latePids.length === 0
    && (attesterPids.length === 0 || attesterPids.every(pid => attestedBy.includes(pid)));
  const iAmInGroup = pids.includes(viewerPid);
  const iAmSigner = signedByPlayerId === viewerPid;
  const iHaveAttested = attestedBy.includes(viewerPid);
  const iAmLate = latePids.includes(viewerPid);
  const myMissingHoles = iAmLate ? missingHolesFor(viewerPid) : [];
  // A late golfer is scoring, not attesting — their action comes back once
  // their own card is full, and it's a signature on their round.
  const needsMyAttestation = isSigned && !isFullyAttested && iAmInGroup && !iAmSigner && !iHaveAttested && !isWithdrawn(viewerPid) && !iAmLate;
  const canSignMyRound = iAmLate && !isWeekLocked && myMissingHoles.length === 0;

  // One-time backfill for cards signed before `roundPids` existed. Freezing
  // the covered set the first time such a card is opened is what keeps a
  // makeup golfer from silently turning back into an "attester" the instant
  // their ninth hole lands (the inference above can't tell the two apart once
  // the round is complete). Idempotent, and skipped entirely until scores
  // have loaded.
  useEffect(() => {
    if (!groupResult || !saveGroupResult) return;
    if (Array.isArray(groupResult.roundPids)) return;
    if (isWeekLocked) return;
    if (inferredCoveredPids.length === 0) return;
    saveGroupResult({ ...groupResult, roundPids: inferredCoveredPids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupResult, isWeekLocked, inferredCoveredPids.join(",")]);

  const signGroup = async () => {
    if (busy || !saveGroupResult) return;
    setBusy(true);
    // Solo / all-others-withdrawn: nobody is left to attest, so the signature
    // self-attests. Mirrors finalizeMatch's autoAttest path — without it a
    // one-golfer group would block the week forever.
    const others = livePids.filter(pid => pid !== viewerPid);
    const autoAttest = others.length === 0;
    await saveGroupResult({
      id: indivGroupResultId(LEAGUE_ID, week, groupMatch),
      week,
      players: pids,
      // The rounds this signature covers — see the coveredPids comment above.
      roundPids: livePids,
      signedByPlayerId: viewerPid || null,
      attestedBy: autoAttest ? others : [],
      attested: autoAttest,
    });
    setBusy(false);
    setToast?.(autoAttest ? "Scorecard signed ✓" : "Scorecard signed — waiting on attestation");
    setTimeout(() => setToast?.(null), 2500);
  };

  const attestGroup = async () => {
    if (busy || !groupResult || !saveGroupResult) return;
    setBusy(true);
    const nextAttestedBy = [...new Set([...attestedBy, viewerPid])];
    // A card still owed a makeup round isn't done, however many attestations
    // are in — the round it's waiting on isn't on it yet.
    const allDone = latePids.length === 0 && attesterPids.every(pid => nextAttestedBy.includes(pid));
    await saveGroupResult({ ...groupResult, roundPids: coveredPids, attestedBy: nextAttestedBy, attested: allDone });
    setBusy(false);
    setToast?.(allDone ? "Scorecard fully attested ✓" : "Attestation recorded ✓");
    setTimeout(() => setToast?.(null), 2000);
  };

  // A golfer posting a round onto an already-signed card signs for it
  // themselves: nobody else in the group was there for a round played days
  // later, so there is no one to attest it. The signature adds them to the
  // card's covered set, which is what releases the card to go final once the
  // original attesters are in.
  const signMyRound = async () => {
    if (busy || !groupResult || !saveGroupResult || !viewerPid) return;
    setBusy(true);
    const nextRoundPids = [...new Set([...coveredPids, viewerPid])];
    const nextAttestedBy = [...new Set([...attestedBy, viewerPid])];
    const stillLate = livePids.filter(pid => !nextRoundPids.includes(pid));
    const nextAttesters = livePids.filter(pid => pid !== signedByPlayerId && nextRoundPids.includes(pid));
    const allDone = stillLate.length === 0 && nextAttesters.every(pid => nextAttestedBy.includes(pid));
    await saveGroupResult({ ...groupResult, roundPids: nextRoundPids, attestedBy: nextAttestedBy, attested: allDone });
    setBusy(false);
    setToast?.(allDone ? "Round signed — scorecard complete ✓" : "Round signed ✓");
    setTimeout(() => setToast?.(null), 2500);
  };

  const unsignGroup = async () => {
    if (!groupResult?.id || !deleteGroupResult) return;
    setConfirmUnsign(false);
    await deleteGroupResult(groupResult.id);
    setToast?.("Scorecard unsigned — scores can be edited again");
    setTimeout(() => setToast?.(null), 2500);
  };

  // Scores lock down once the card is fully attested or the week is locked —
  // same rule the match view applies, and for the same reason: edits after
  // verification would silently invalidate the signature.
  const scoresLocked = isWeekLocked || isFullyAttested;
  // isComm can sign a group they aren't in — matching the match view, where
  // the commissioner can sign any match. Without it, a group that all went
  // home without signing would block the week with no way to unblock it
  // (force-attest only works on cards that HAVE a signature).
  const canSign = allowSigning && !isSigned && !isWeekLocked && (iAmInGroup || isComm) && allComplete;

  return (
    <div style={{ maxWidth: 420, margin: "0 auto" }}>
      {onBack && (
        <div style={{ marginBottom: 8 }}>
          <BackBtn onClick={onBack} />
        </div>
      )}
      {header}

      {isWeekLocked && (
        <div style={{ background: K.warn + "18", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "6px 10px", marginBottom: 4, fontSize: FS.sm, color: K.warn, fontWeight: FW.bold, textAlign: "center" }}>
          Week {week} is locked — scores are read-only
        </div>
      )}

      {/* Hole strip — a hole is "done" when every golfer still in the event
          has a score on it. Withdrawn golfers are excluded so their blank
          card doesn't hold the strip open. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const live = pids.filter(pid => !isWithdrawn(pid));
          const done = live.length > 0 && live.every(pid => getScore(pid, i) > 0);
          const cur = i === curHole;
          return <button key={i} onClick={() => setCurHole(i)} style={{ flex: 1, height: 32, borderRadius: done || cur ? 8 : 6, border: done && !cur ? `1.5px solid ${K.acc}50` : "none", background: cur ? K.acc : done ? K.acc + "15" : K.card, color: cur ? K.bg : done ? K.acc : K.t3, fontSize: FS.base, fontWeight: FW.bold, cursor: "pointer", outline: cur ? `2px solid ${K.acc}` : "none", outlineOffset: 1 }}>{side === 'front' ? i + 1 : i + 10}</button>;
        })}
      </div>

      {/* Full Scorecard doubles as the sign entry point once every live card
          is complete — same promotion the match view's button does, so the
          gesture is identical whichever kind of round you're playing. */}
      <button onClick={() => setShowCard(v => !v)} style={canSign && !showCard
        ? { width: "100%", padding: 10, borderRadius: 10, marginBottom: 8, cursor: "pointer", background: K.hcpBlue + "15", border: `1.5px solid ${K.hcpBlue}50`, color: K.hcpBlue, fontSize: FS.base, fontWeight: FW.bold, letterSpacing: .3 }
        : { width: "100%", padding: "6px 0", borderRadius: 8, marginBottom: 8, cursor: "pointer", background: K.card, border: `1px solid ${K.bdr}60`, color: K.t2, fontSize: FS.xs, fontWeight: FW.bold, letterSpacing: .5 }}>
        {showCard ? "Hide Scorecard" : canSign ? "Complete — Review & Sign" : "Full Scorecard"}
      </button>

      {showCard && (
        <div style={{ marginBottom: 6 }}>
          <sc.HoleRow />
          <sc.ParRow />
          <sc.HcpRow />
          {pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {pids.map(pid => {
              const ir = resolveFor(pid);
              const line = computeRoundLine({ ir, pars, hcps, roundHcp: getHcp(pid) });
              const label = ir.withdrawn ? "ABS"
                : isMakingUp(pid) ? "MU"
                : !line.played ? "—"
                : line.netToPar > 0 ? `+${line.netToPar}` : line.netToPar === 0 ? "E" : `${line.netToPar}`;
              return (
                <div key={pid} style={{ fontSize: FS.micro, fontWeight: FW.semibold, color: K.t3, background: K.inp, border: `1px solid ${K.bdr}`, borderRadius: 5, padding: "2px 6px" }}>
                  {getInitials(pid)} net <strong style={{ color: K.t1 }}>{label}</strong>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ background: K.acc, borderRadius: 10, padding: "4px 8px", marginBottom: 4, display: "flex", alignItems: "center" }}>
        <button onClick={() => setCurHole(h => Math.max(0, h - 1))} disabled={curHole === 0} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 0 ? "default" : "pointer", color: curHole === 0 ? K.bg + "40" : K.bg, fontSize: FS.lg, fontWeight: FW.bold, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px" }}>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: FW.semibold, opacity: 0.7 }}>Par</div><div style={{ fontSize: FS.base, fontWeight: FW.heavy, color: K.bg }}>{par}</div></div>
          <div style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: K.bg, fontWeight: FW.semibold, textTransform: "uppercase", letterSpacing: 1, opacity: 0.7 }}>Hole</div><div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: FS.xxl, fontWeight: FW.bold, color: K.bg, lineHeight: 1 }}>{holeLabel}</div></div>
          <div style={{ textAlign: "center", minWidth: 32 }}><div style={{ fontSize: 8, color: K.bg, fontWeight: FW.semibold, opacity: 0.7 }}>HCP</div><div style={{ fontSize: FS.base, fontWeight: FW.heavy, color: K.bg }}>{holeHcp}</div></div>
        </div>
        <button onClick={() => setCurHole(h => Math.min(8, h + 1))} disabled={curHole === 8} style={{ width: 28, height: 36, borderRadius: 8, background: "none", border: "none", cursor: curHole === 8 ? "default" : "pointer", color: curHole === 8 ? K.bg + "40" : K.bg, fontSize: FS.lg, fontWeight: FW.bold, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
      </div>

      {/* ── Signature / attestation panel ────────────────────────────────
          Placed above the score cards so the state of the card is the first
          thing you see when you reopen the round after signing. */}
      {(isSigned || canSign) && (
        <div style={{ background: K.card, border: `1px solid ${isFullyAttested ? K.grn + "50" : K.bdr}60`, borderRadius: 10, padding: "10px 12px", marginBottom: 6 }}>
          {!isSigned ? (<>
            <div style={{ fontSize: FS.xs, color: K.t2, marginBottom: 8, lineHeight: 1.4 }}>
              All cards are in. Sign to submit this group's rounds to the individual tournament — someone else in the group then attests.
            </div>
            <button onClick={signGroup} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 10, background: busy ? K.t3 : K.hcpBlue, border: "none", color: "#fff", fontSize: 14, fontWeight: FW.heavy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              Sign Scorecard
            </button>
          </>) : (<>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: FS.micro, fontWeight: FW.heavy, letterSpacing: .8, textTransform: "uppercase", color: isFullyAttested ? K.grn : K.warn }}>
                {isFullyAttested ? "✓ Signed & Attested"
                  : latePids.length > 0 ? "Signed — awaiting a makeup round"
                  : "Signed — awaiting attestation"}
              </span>
            </div>
            {signedByPlayerId && playerMap[signedByPlayerId] && (
              <div style={{ fontSize: FS.micro, color: K.t3, fontWeight: FW.semibold, marginBottom: 6 }}>
                Signed by {playerMap[signedByPlayerId].name}
              </div>
            )}
            {/* Per-golfer chips. Attesters read the same as the match view's
                attest row; a golfer who joined the card after it was signed
                gets a gold "round pending" chip instead — the card is waiting
                on their SCORES, not their signature, and the two shouldn't
                look alike. */}
            {(attesterPids.length > 0 || latePids.length > 0) && (
              <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
                {attesterPids.map(pid => {
                  const done = attestedBy.includes(pid);
                  return (
                    <div key={pid} style={{ fontSize: 10, fontWeight: FW.semibold, padding: "3px 8px", borderRadius: 4, background: done ? K.grn + "18" : K.inp, border: `1px solid ${done ? K.grn + "40" : K.bdr}`, color: done ? K.grn : K.t3 }}>
                      {done ? "✓ " : ""}{playerMap[pid]?.name?.split(' ').pop() || "?"}
                    </div>
                  );
                })}
                {latePids.map(pid => (
                  <div key={pid} style={{ fontSize: 10, fontWeight: FW.semibold, padding: "3px 8px", borderRadius: 4, background: K.act + "18", border: `1px solid ${K.act}40`, color: K.act }}>
                    {playerMap[pid]?.name?.split(' ').pop() || "?"} · round pending
                  </div>
                ))}
              </div>
            )}
            {needsMyAttestation && (
              <button onClick={attestGroup} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 10, background: busy ? K.t3 : K.hcpBlue, border: "none", color: "#fff", fontSize: 14, fontWeight: FW.heavy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                Attest Scorecard
              </button>
            )}
            {/* Late golfer, card not full yet — the only thing being asked of
                them is the round. Same "missing scores" language the match
                view uses so the two screens read alike. */}
            {iAmLate && myMissingHoles.length > 0 && !isWeekLocked && (
              <div style={{ background: K.warn + "15", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "8px 10px", fontSize: FS.xs, color: K.warn, fontWeight: FW.bold, lineHeight: 1.4 }}>
                <div style={{ marginBottom: 3 }}>⚠️ Missing scores — can't sign yet</div>
                <div style={{ color: K.t2, fontWeight: FW.semibold }}>
                  Enter your round: {myMissingHoles.length === 9
                    ? "holes " + myMissingHoles[0] + "–" + myMissingHoles[8]
                    : (myMissingHoles.length === 1 ? "hole " : "holes ") + myMissingHoles.join(", ")}
                </div>
              </div>
            )}
            {canSignMyRound && (
              <button onClick={signMyRound} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 10, background: busy ? K.t3 : K.hcpBlue, border: "none", color: "#fff", fontSize: 14, fontWeight: FW.heavy, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
                Sign Scorecard
              </button>
            )}
            {iHaveAttested && !isFullyAttested && (
              <div style={{ textAlign: "center", fontSize: 12, color: K.t3, fontWeight: FW.semibold, padding: "6px 0" }}>
                You attested — waiting for others
              </div>
            )}
            {/* Unsign — anyone in the group before it's fully attested, and the
                commissioner after, matching the match view's escape hatch.
                Blocked once the week is locked; that's a re-open, not an edit. */}
            {!isWeekLocked && (iAmInGroup || isComm) && (!isFullyAttested || isComm) && (
              confirmUnsign ? (
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={unsignGroup} style={{ flex: 1, padding: 9, borderRadius: 8, background: K.warn, border: "none", color: K.bg, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}>Unsign</button>
                  <button onClick={() => setConfirmUnsign(false)} style={{ padding: "9px 14px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.sm, fontWeight: FW.bold, cursor: "pointer" }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setConfirmUnsign(true)} style={{ width: "100%", padding: "7px 0", borderRadius: 8, marginTop: 6, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.xs, fontWeight: FW.bold, cursor: "pointer" }}>
                  Unsign &amp; Edit
                </button>
              )
            )}
          </>)}
        </div>
      )}

      {pids.map(pid => {
        const pl = playerMap[pid];
        if (!pl) return null;
        // Flagged golfers collapse to a status row — there's no card to score
        // tonight, so the score buttons would be dead weight.
        const flagged = isWithdrawn(pid) ? "absent" : isMakingUp(pid) ? "makeup" : null;
        if (flagged) {
          const isAbs = flagged === "absent";
          const color = isAbs ? K.red : K.act;
          return (
            <Card key={pid} style={{ marginBottom: 3, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: FW.bold, flex: 1, minWidth: 0, color: K.t3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pl.name}</span>
              <span style={{ flexShrink: 0, fontSize: FS.micro, fontWeight: FW.heavy, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 5, padding: "2px 6px", letterSpacing: .5 }}>
                {isAbs ? "ABSENT" : "MAKING UP"}
              </span>
              {!scoresLocked && (
                <button onClick={() => clearAttendance(pid)} style={{ flexShrink: 0, padding: "3px 8px", borderRadius: 5, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: FS.micro, fontWeight: FW.bold, cursor: "pointer" }}>
                  Undo
                </button>
              )}
            </Card>
          );
        }
        // Absent / Making Up — offered only while the golfer has no scores, so
        // a mis-tap can't silently discard a played round. Once a card is
        // started the round exists; changing it is a commissioner edit via
        // Schedule → Edit Scores.
        const hasAnyScore = (() => { for (let h = 0; h < 9; h++) if (getScore(pid, h) > 0) return true; return false; })();
        const attnBtns = (allowAttendance && !scoresLocked && !hasAnyScore) ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={() => setGroupConfirm({
                title: `Mark ${pl.name} as making up?`,
                message: `${pl.name} will post their individual round later. The rest of the group can sign tonight; their makeup is entered when it's played.`,
                onConfirm: () => { markMakingUp(pid); setGroupConfirm(null); },
              })}
              style={{ fontSize: FS.xs, fontWeight: FW.semibold, color: K.t3, background: "none", border: `1px solid ${K.bdr}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}
            >
              Makeup
            </button>
            <button
              onClick={() => setGroupConfirm({
                title: `Mark ${pl.name} as absent?`,
                message: `${pl.name} is out of the individual tournament for Week ${week} — no round is recorded and the group can sign without them.`,
                onConfirm: () => { markAbsent(pid); setGroupConfirm(null); },
              })}
              style={{ fontSize: FS.xs, fontWeight: FW.semibold, color: K.t3, background: "none", border: `1px solid ${K.bdr}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}
            >
              Absent
            </button>
          </div>
        ) : null;
        return (
          // Thin maize rail on the viewer's own card. The group is listed in
          // tee order (worst net first), so "mine" isn't a fixed position and
          // needs a marker to find at a glance mid-round.
          <div key={pid} style={viewerPid && pid === viewerPid
            ? { borderLeft: `3px solid ${K.act}`, borderRadius: 4, paddingLeft: 3, marginLeft: -6 }
            : undefined}>
            <PlayerScoreCard
              pl={pl}
              score={getScore(pid, curHole)}
              strokes={getStrokes(pid, curHole)}
              nh={getHcp(pid)}
              run={getRunning(pid)}
              btns={[par - 1, par, par + 1, par + 2, par + 3]}
              par={par}
              pid={pid}
              week={week}
              curHole={curHole}
              saveScore={guardedSaveScore}
              K={K}
              absentBtn={attnBtns}
            />
          </div>
        );
      })}

      <ConfirmModal modal={groupConfirm && { ...groupConfirm, onCancel: () => setGroupConfirm(null) }} />
      <ScoringToast toast={toast} />
    </div>
  );
}

export function PlayerScoreCard({ pl, score, strokes, nh, run, btns: defaultBtns, par, pid, week, curHole, saveScore, K, absentBtn }) {
  const handleScore = (val) => {
    saveScore(week, pid, curHole, val);
  };
  const maxBtn = defaultBtns[defaultBtns.length - 1];
  const minBtn = defaultBtns[0];
  let btns = defaultBtns;
  if (score > maxBtn) {
    const shift = score - maxBtn;
    btns = defaultBtns.map(b => b + shift);
  } else if (score > 0 && score < minBtn) {
    const shift = minBtn - score;
    btns = defaultBtns.map(b => b - shift);
  }
  // Reference equality is intentional: btns === defaultBtns is true ONLY when
  // recenter didn't fire (we'd have re-assigned btns to a freshly-mapped array).
  // When labels would mislabel a shifted number (e.g. "Birdie" sitting under a
  // 5 on a par 4 because we shifted to [5,6,7,8,9] for a triple-bogey-or-worse
  // entry) we just hide them. Empty-string label slot still reserves vertical
  // space so the row height doesn't shift between default and recentered.
  const showLabels = btns === defaultBtns;
  // Last name + first initial — matches the rest of the app's last-name
  // display convention but adds a tiny initial in front so teammates with
  // the same last name (or simply different players with similar names)
  // stay disambiguated at a glance. Single-name players (rare but possible
  // in a recreational league with a nickname-only entry) skip the initial.
  const nameParts = pl.name.split(' ').filter(Boolean);
  const lastName = nameParts[nameParts.length - 1] || pl.name;
  const firstInitial = nameParts.length > 1 ? nameParts[0][0] : null;
  const displayName = firstInitial ? `${firstInitial}. ${lastName}` : lastName;

  return (
    <Card style={{ marginBottom: 3, padding: "6px 10px" }}>
      {/* Top row — initial + last name + handicap pill + stroke dots
          clustered tight on the LEFT, with a flex spacer pushing the
          Absent button to the right edge. The name can shrink/truncate
          (minWidth: 0 + ellipsis) on very narrow screens but normally
          takes its natural width so handicap and stroke dots sit
          visually attached to the player it's describing. Handicap
          color matches stroke dots (K.hcpBlue) so the whole stroke-
          allocation context reads as a single unit. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: FW.bold, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{displayName}</span>
        <span style={{ fontSize: FS.xs, fontWeight: FW.bold, flexShrink: 0 }}>
          (<span style={{ color: K.hcpBlue }}>{nh}</span>)
        </span>
        {strokes > 0 && <span style={{ color: K.hcpBlue, fontSize: 12, letterSpacing: 1, flexShrink: 0, lineHeight: 1 }}>{"●".repeat(strokes)}</span>}
        <div style={{ flex: 1 }} />
        {absentBtn}
      </div>
      {/* Net / thru sub-line — tightened to recover vertical space for
          the top-positioned Full Scorecard button. minHeight still
          reserves the slot before scoring starts so the layout doesn't
          jump on first score entry. */}
      <div style={{ fontSize: 10, color: K.t3, marginBottom: 3, lineHeight: 1.1, minHeight: 10 }}>
        {run.thru > 0 && (
          <>Net <strong style={{ color: run.netVsPar < 0 ? K.red : run.netVsPar === 0 ? K.t3 : K.t1, fontWeight: FW.bold }}>{run.netVsPar > 0 ? "+" + run.netVsPar : run.netVsPar === 0 ? "E" : run.netVsPar}</strong> thru {run.thru}</>
        )}
      </div>
      {/* Score-button row — 5 par-relative buttons at 44px tall (Apple HIG
          minimum touch target) plus −/+ nudge buttons. Each score button
          stacks a label beneath it (Birdie / Par / Bogey / Double / Triple);
          labels render empty in the recenter case (see showLabels). The −/+
          buttons intentionally have no labels — they're nudge controls, not
          scores. The 12px reserved label slot keeps the row height stable
          regardless of recenter state. */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
        {/* − nudge button moved to the FAR LEFT so the par button sits
            dead center of the 7-button row. Symmetric with the + on the
            far right. */}
        <button onClick={() => handleScore(Math.max(1, (score || par) - 1))} style={{ width: 30, height: 44, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: FW.bold, cursor: "pointer", flexShrink: 0 }}>−</button>
        {btns.map((btn, idx) => {
          const isCur = btn === score; const sd = btn - par;
          const boxSize = 32;
          // Par anchor — the button matching par gets a subtle label
          // emphasis (brighter color + bolder weight) so the golfer's
          // eye finds par as the visual reference. Suppressed when par
          // is the selected score, since the gold active background
          // already serves as the focal point. In the recenter case
          // (e.g. a 9 on par 4 → btns become [5,6,7,8,9]), par isn't
          // in the array so isPar is false everywhere and no emphasis
          // shows — the unlabeled state already signals "abnormal."
          const isPar = btn === par;
          const showParAnchor = isPar && !isCur;
          return (
            <div key={btn} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
              <button onClick={() => handleScore(isCur ? 0 : btn)} style={{ width: "100%", height: 44, borderRadius: 8, cursor: "pointer", fontSize: FS.base, fontWeight: FW.heavy, border: "none", background: isCur ? K.acc : K.inp, color: isCur ? K.bg : K.t2, position: "relative", transition: "all .15s", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* SELECTED-STATE rings: solid red circles for under-par
                    (single for birdie, double for eagle), solid bg-color
                    squares for over-par (single for bogey, double for
                    double-bogey-or-worse). Renders on top of the gold
                    selected background so the rings contrast cleanly. */}
                {isCur && sd !== 0 && <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.5px solid ${sd < 0 ? K.red : K.bg}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? K.red : K.bg}` }} />}</div>}
                {/* RESTING-STATE faint outlines on non-par buttons. Same
                    geometry as the selected state but at 0.15 opacity, and
                    in resting-button colors (K.red for under-par circles,
                    K.t2 for over-par squares). Double squares appear for
                    sd >= 2 (double-bogey and worse) mirroring the
                    selected-state convention. Suppressed when the button
                    is selected — the solid ring above takes over. Also
                    suppressed for par buttons (sd === 0) — par is its
                    own anchor via the label emphasis. */}
                {!isCur && sd !== 0 && <div style={{ position: "absolute", width: boxSize, height: boxSize, left: "50%", top: "50%", transform: "translate(-50%, -50%)", opacity: 0.15 }}><div style={{ position: "absolute", inset: 0, borderRadius: sd < 0 ? "50%" : 3, border: `1.25px solid ${sd < 0 ? K.red : K.t2}` }} />{Math.abs(sd) >= 2 && <div style={{ position: "absolute", inset: 3, borderRadius: sd < 0 ? "50%" : 2, border: `1px solid ${sd < 0 ? K.red : K.t2}` }} />}</div>}
                <span style={{ position: "relative", zIndex: 1 }}>{btn}</span>
              </button>
              {/* Par's label gets a brighter color + bolder weight so the
                  "Par" word also reads as the visual anchor below the
                  button. Both cues fire from the same `showParAnchor`
                  flag so the anchor disappears together when par is
                  selected. */}
              <div style={{ fontSize: FS.micro, color: showParAnchor ? K.t2 : K.t3, fontWeight: showParAnchor ? FW.bold : FW.semibold, letterSpacing: 0.4, lineHeight: 1, height: 12 }}>
                {showLabels ? SCORE_LABELS[idx] : ""}
              </div>
            </div>
          );
        })}
        <button onClick={() => handleScore((score || par) + 1)} style={{ width: 30, height: 44, borderRadius: 8, background: K.inp, border: "none", color: K.t3, fontSize: 14, fontWeight: FW.bold, cursor: "pointer", flexShrink: 0 }}>+</button>
      </div>
    </Card>
  );
}
