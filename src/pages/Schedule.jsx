import { useState, useMemo, useCallback, useEffect } from "react";
import { K, SubLabel, Pill, EmptyState, lastNamesOnly, formatTeeTime, getWeekSide, LIST_GAP, CARD_RADIUS, NAME_SIZE, HERO_NUM_SIZE, CHEVRON_SIZE, buildSeedMap } from "../theme";
import { LEAGUE_ID } from "../firebase";
import { SharedScorecard } from "./Scoring";
import { computeMatchResult, readScoreEffective, getStrokesForHole } from "../lib/matchCalc";

export default function ScheduleView({ schedule, teams, players, matchResults, leagueUser, leagueConfig, course, fetchWeekScores, scoringRules, isComm, saveScore, saveMatchResult, setPopupOpen }) {
  const [showAll, setShowAll] = useState(false);
  const [myOnly, setMyOnly] = useState(true);
  const [expandedWeeks, setExpandedWeeks] = useState({});
  const [expandedMatchKey, setExpandedMatchKey] = useState(null); // "week_mi"
  const [matchScores, setMatchScores] = useState({}); // { week: { key: score } }
  const [editingMatch, setEditingMatch] = useState(null); // { wk, m, res }
  const [editScores, setEditScores] = useState({}); // { "pid_h": score }
  // Per-player absent flags within the edit popup. Initialized from Firestore
  // when the popup opens, then toggled inline if the commissioner needs to
  // mark someone absent or restore them to present (e.g. after a scheduled
  // make-up round). Persisted to Firestore on save via saveScore(week, pid,
  // "absent", 0|1). Default treats "no entry yet" as not absent.
  const [editAbsent, setEditAbsent] = useState({}); // { pid: boolean }
  // Pending-edit confirmation state. When the commissioner taps "Save & Re-sign",
  // we don't immediately persist. We compute the new match_result, diff it
  // against the existing one, and (if anything changed) show a confirmation
  // popup listing the changes. This catches the "I just wanted to fix one
  // typo, why did the standings flip?" surprise — the commissioner sees
  // exactly what's about to change before committing.
  // Shape: { calc, diff, changedScores, changedAbsents } where:
  //   calc          = the recomputed match_result fields (ready to persist)
  //   diff          = { result?, t1Points?, t2Points?, ... } human-readable changes
  //   changedScores = [{ playerName, hole, oldVal, newVal }] for the score diff list
  //   changedAbsents = [{ playerName, oldAbsent, newAbsent }]
  const [pendingEdits, setPendingEdits] = useState(null);
  const [saving, setSaving] = useState(false);

  // Notify parent when edit popup is open
  useEffect(() => {
    if (setPopupOpen) setPopupOpen(!!editingMatch);
  }, [editingMatch, setPopupOpen]);

  // Seed map for showing seed badges during seeded/playoff weeks.
  // Uses shared helper — prefers lockedSeeds snapshot; falls back to current standings.
  // Note: for past seeded weeks in leagues that DIDN'T lock seeds, this shows current
  // standings rather than historical standings. The lockedSeeds workflow is the right
  // tool if you want stable, at-the-time seeds for retrospective viewing.
  const seedMap = useMemo(
    () => buildSeedMap(teams, matchResults, schedule, leagueConfig),
    [teams, matchResults, schedule, leagueConfig]
  );

  const toggleWeek = (weekNum) => {
    setExpandedWeeks(prev => ({ ...prev, [weekNum]: !prev[weekNum] }));
  };

  const toggleMatchExpand = useCallback(async (weekNum, mi) => {
    const key = `${weekNum}_${mi}`;
    if (expandedMatchKey === key) {
      setExpandedMatchKey(null);
      return;
    }
    setExpandedMatchKey(key);
    // Fetch scores for this week if not already loaded
    if (!matchScores[weekNum] && fetchWeekScores) {
      const scores = await fetchWeekScores(weekNum);
      setMatchScores(prev => ({ ...prev, [weekNum]: scores }));
    }
  }, [expandedMatchKey, matchScores, fetchWeekScores]);

  // ── Commissioner score editing ──
  // Stripped the bounding-rect anchor calculation that the previous fix used —
  // it positioned the popup in document coordinates which then required the
  // user to be scrolled to exactly the right spot. Switched to viewport-fixed
  // positioning so the popup is ALWAYS visible regardless of where the user
  // scrolled before tapping Edit Scores.
  const openEditScores = (wk, m, res) => {
    const wkScores = matchScores[wk.week] || {};
    const t1 = teams.find(t => t.id === m.team1);
    const t2 = teams.find(t => t.id === m.team2);
    const allPids = [t1?.player1, t1?.player2, t2?.player1, t2?.player2].filter(Boolean);
    const initial = {};
    const initialAbsent = {};
    allPids.forEach(pid => {
      for (let h = 0; h < 9; h++) {
        initial[`${pid}_${h}`] = wkScores[`w${wk.week}_p${pid}_h${h}`] || 0;
      }
      initialAbsent[pid] = wkScores[`w${wk.week}_p${pid}_habsent`] === 1;
    });
    setEditScores(initial);
    setEditAbsent(initialAbsent);
    setEditingMatch({ wk, m, res });
  };

  // First click of "Save & Re-sign": don't persist yet. Compute the recalculation
  // locally, diff it against the existing match_result + score state, and stash
  // the result in `pendingEdits` to drive the confirmation popup. The actual
  // persist happens in commitEditedScores after the commissioner confirms.
  // This split exists because finalized weeks are durable historical records;
  // surprising the commissioner with "your tap rewrote 3 weeks of standings"
  // would be alarming. The diff popup makes the consequences visible first.
  const prepareEditedScores = () => {
    if (!editingMatch || !saveScore || !saveMatchResult) return;
    const { wk, m, res } = editingMatch;
    const weekNum = wk.week;
    const side = wk.side || getWeekSide(weekNum);
    const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
    const hcps = course ? (side === 'front' ? course.frontHcps : course.backHcps) : [1,3,5,7,9,11,13,15,17];
    const t1 = teams.find(t => t.id === m.team1);
    const t2 = teams.find(t => t.id === m.team2);
    const t1Pids = [t1?.player1, t1?.player2].filter(Boolean);
    const t2Pids = [t2?.player1, t2?.player2].filter(Boolean);
    const allPids = [...t1Pids, ...t2Pids];

    const oldScores = matchScores[weekNum] || {};

    // Build the holeScores object that matchCalc expects, by overlaying our
    // edited per-hole values AND absent flags on top of the existing Firestore
    // data. We use the latest editAbsent state so re-marking a player as
    // present (e.g. after they play a make-up round) takes effect immediately
    // in the recalculation.
    const holeScoresForCalc = { ...oldScores };
    allPids.forEach(pid => {
      for (let h = 0; h < 9; h++) {
        holeScoresForCalc[`w${weekNum}_p${pid}_h${h}`] = editScores[`${pid}_${h}`] || 0;
      }
      if (editAbsent[pid]) {
        holeScoresForCalc[`w${weekNum}_p${pid}_habsent`] = 1;
      } else {
        delete holeScoresForCalc[`w${weekNum}_p${pid}_habsent`];
      }
    });

    // Single source of truth: compute via matchCalc.js. Same calculation
    // Scoring.jsx uses on Sign Scorecard, so a commissioner-edit and a fresh
    // sign produce identical match_results given identical scores.
    const calc = computeMatchResult({
      match: m,
      week: weekNum,
      isPlayoff: wk.isPlayoff === true,
      teams,
      players,
      holeScores: holeScoresForCalc,
      pars,
      hcps,
      scoringRules,
      leagueConfig,
      seedMap,
    });

    // ── Diff: what changed at the match-result level ────────────────────────
    // res may be null (legacy edge case) — treat that as "all fields new."
    const diff = {};
    if (res) {
      if (calc.matchResultText !== res.matchResultText) {
        diff.result = { from: res.matchResultText || "—", to: calc.matchResultText };
      }
      if (calc.team1Points !== res.team1Points) {
        diff.t1Points = { from: res.team1Points ?? 0, to: calc.team1Points };
      }
      if (calc.team2Points !== res.team2Points) {
        diff.t2Points = { from: res.team2Points ?? 0, to: calc.team2Points };
      }
      if (calc.matchWinnerId !== res.matchWinnerId) {
        const fromTeam = teams.find(t => t.id === res.matchWinnerId);
        const toTeam = teams.find(t => t.id === calc.matchWinnerId);
        diff.winner = {
          from: fromTeam ? lastNamesOnly(fromTeam.name) : "Tie",
          to: toTeam ? lastNamesOnly(toTeam.name) : "Tie",
        };
      }
    } else {
      diff.result = { from: "—", to: calc.matchResultText };
    }

    // ── Diff: per-hole score changes ────────────────────────────────────────
    const changedScores = [];
    const playerName = (pid) => {
      const p = players.find(pl => pl.id === pid);
      return p ? p.name.split(' ').pop() : "?";
    };
    for (const pid of allPids) {
      for (let h = 0; h < 9; h++) {
        const newVal = editScores[`${pid}_${h}`] || 0;
        const oldVal = oldScores[`w${weekNum}_p${pid}_h${h}`] || 0;
        if (newVal !== oldVal) {
          changedScores.push({
            playerName: playerName(pid),
            hole: side === 'front' ? h + 1 : h + 10,
            oldVal,
            newVal,
          });
        }
      }
    }

    // ── Diff: absent-flag changes ───────────────────────────────────────────
    const changedAbsents = [];
    for (const pid of allPids) {
      const newAbsent = !!editAbsent[pid];
      const oldAbsent = oldScores[`w${weekNum}_p${pid}_habsent`] === 1;
      if (newAbsent !== oldAbsent) {
        changedAbsents.push({
          playerName: playerName(pid),
          newAbsent,
        });
      }
    }

    // No changes at all? Just close the popup. Nothing to confirm, nothing
    // to save. Avoids a confusing "confirm no changes?" modal.
    if (!changedScores.length && !changedAbsents.length && Object.keys(diff).length === 0) {
      setEditingMatch(null);
      return;
    }

    // Stash everything the commit step needs. We keep allPids/etc separate
    // from `calc` so commitEditedScores doesn't need to recompute anything —
    // it just persists exactly what the user confirmed.
    setPendingEdits({
      calc,
      diff,
      changedScores,
      changedAbsents,
      // Persist context for the commit step
      allPids,
      weekNum,
      t1, t2,
      oldScores,
    });
  };

  // Second step: actually persist after the user confirms in the diff popup.
  const commitEditedScores = async () => {
    if (!pendingEdits || !editingMatch) return;
    const { wk, m, res } = editingMatch;
    // Pull t2 alongside t1 — earlier version of this function omitted t2 from
    // the destructure, which threw ReferenceError on the saveMatchResult call
    // that needs both team IDs to build the result doc's id. The throw exited
    // the async function before reaching `setSaving(false)`, leaving the
    // confirmation button stuck on "Saving..." with no way out except
    // refreshing the page.
    const { calc, allPids, weekNum, t1, t2, oldScores } = pendingEdits;
    setSaving(true);

    // Wrap the persist sequence in try/finally so any future save error
    // doesn't permanently lock the UI on "Saving..." — the user always gets
    // their button back, even if a write fails. The actual error (Firestore
    // rejection, network timeout, etc.) bubbles up to the toast/console
    // surface — but the popup state recovers regardless.
    try {
      // Persist score changes
      for (const pid of allPids) {
        for (let h = 0; h < 9; h++) {
          const newVal = editScores[`${pid}_${h}`] || 0;
          const oldVal = oldScores[`w${weekNum}_p${pid}_h${h}`] || 0;
          if (newVal !== oldVal) await saveScore(weekNum, pid, h, newVal);
        }
        const newAbsent = editAbsent[pid] ? 1 : 0;
        const oldAbsent = oldScores[`w${weekNum}_p${pid}_habsent`] === 1 ? 1 : 0;
        if (newAbsent !== oldAbsent) await saveScore(weekNum, pid, "absent", newAbsent);
      }

      // Persist the recomputed match_result. We pass the pre-computed `calc`
      // straight through so this writes EXACTLY what the user just confirmed
      // — no chance of recomputing with stale state and surprising them.
      await saveMatchResult({
        ...calc,
        id: `${LEAGUE_ID}_w${weekNum}_${t1.id}_${t2.id}`,
        week: weekNum,
        finalizedByTeamId: res?.finalizedByTeamId || null,
        signedByPlayerId: res?.signedByPlayerId || leagueUser?.playerId || null,
        // Preserve attestation state when a commissioner edits scores on an already-
        // finalized match. The original code reset attestedBy to undefined, which meant
        // any force-attest history was silently wiped and "N of M attested" badges
        // would go stale on the very next edit.
        attested: res?.attested || false,
        attestedBy: res?.attestedBy || [],
      });

      // Update local cache so the UI reflects the change without waiting for
      // the realtime subscription to round-trip.
      const updatedScores = { ...(matchScores[weekNum] || {}) };
      allPids.forEach(pid => {
        for (let h = 0; h < 9; h++) updatedScores[`w${weekNum}_p${pid}_h${h}`] = editScores[`${pid}_${h}`] || 0;
        const absentKey = `w${weekNum}_p${pid}_habsent`;
        if (editAbsent[pid]) updatedScores[absentKey] = 1;
        else delete updatedScores[absentKey];
      });
      setMatchScores(prev => ({ ...prev, [weekNum]: updatedScores }));

      // Success path: drop both popup states and we're done.
      setPendingEdits(null);
      setEditingMatch(null);
    } catch (err) {
      // Surface the failure rather than silently leaving the UI stuck.
      // Toast surface here is the parent container; logging gives detail
      // for debugging via console.
      console.error("Save edited scores failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const displayNames = useMemo(() => {
    const lastNames = {};
    players.forEach(p => {
      const parts = p.name.split(' ');
      const last = parts[parts.length - 1];
      if (!lastNames[last]) lastNames[last] = [];
      lastNames[last].push(p);
    });
    const map = {};
    players.forEach(p => {
      const parts = p.name.split(' ');
      const last = parts[parts.length - 1];
      map[p.id] = lastNames[last].length > 1 ? `${parts[0][0]}. ${last}` : last;
    });
    return map;
  }, [players]);

  const dn = (id) => displayNames[id] || "TBD";

  const myTeam = useMemo(() => {
    if (!leagueUser?.playerId) return null;
    return teams.find(t => t.player1 === leagueUser.playerId || t.player2 === leagueUser.playerId);
  }, [teams, leagueUser]);

  const currentWeekIdx = useMemo(() => {
    for (let i = 0; i < schedule.length; i++) {
      const wk = schedule[i];
      if (wk.rainedOut) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      if (!wk.locked) return i;
    }
    return schedule.length - 1;
  }, [schedule, matchResults]);

  const isWeekComplete = (wk) => {
    if (!wk.matches || wk.matches.length === 0) return false;
    // A week is complete if it's locked OR if all matches have results
    if (wk.locked) return true;
    return wk.matches.every(m =>
      matchResults.some(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2)
    );
  };

  const fmtTeeTime = (idx) => {
    const base = leagueConfig?.startTime ?? "4:28 PM";
    const interval = leagueConfig?.teeInterval ?? 8;
    return formatTeeTime(base, idx, interval);
  };

  // Build records through a specific week (inclusive)
  const getRecordThrough = useCallback((teamId, throughWeek) => {
    let w = 0, l = 0, t = 0;
    matchResults.forEach(r => {
      if (!r || r.week > throughWeek) return;
      const d = (r.team1Points || 0) - (r.team2Points || 0);
      if (r.team1Id === teamId) {
        if (d > 0) w++; else if (d < 0) l++; else t++;
      } else if (r.team2Id === teamId) {
        if (d < 0) w++; else if (d > 0) l++; else t++;
      }
    });
    return { w, l, t };
  }, [matchResults]);

  const fmtRecord = (teamId, throughWeek) => {
    if (!teamId) return "0-0-0";
    const r = getRecordThrough(teamId, throughWeek);
    return `${r.w}-${r.l}-${r.t}`;
  };

  const { upcoming, complete } = useMemo(() => {
    const up = [];
    const done = [];
    schedule.forEach(wk => {
      if (wk.rainedOut || isWeekComplete(wk)) done.push(wk);
      else up.push(wk);
    });
    return { upcoming: up, complete: done };
  }, [schedule, matchResults]);

  const weeksToShow = useMemo(() => {
    if (myOnly || showAll) return { upcoming, complete };
    if (currentWeekIdx >= 0 && currentWeekIdx < schedule.length) {
      const wk = schedule[currentWeekIdx];
      if (isWeekComplete(wk)) return { upcoming: [], complete: [wk] };
      return { upcoming: [wk], complete: [] };
    }
    return { upcoming: schedule.slice(0, 1), complete: [] };
  }, [showAll, myOnly, schedule, currentWeekIdx, upcoming, complete]);

  const getExpanded = (weekNum) => {
    if (expandedWeeks[weekNum] !== undefined) return expandedWeeks[weekNum];
    if (!showAll && !myOnly) return true;
    return weekNum === schedule[currentWeekIdx]?.week;
  };

  if (!schedule.length) return <EmptyState icon="calendar" title="No schedule yet" subtitle="Commissioner needs to generate the schedule." />;

  // ── ICS calendar ──
  const addAllToCalendar = async () => {
    if (!myTeam) return;
    const base = leagueConfig?.startTime ?? "4:28 PM";
    const interval = leagueConfig?.teeInterval ?? 8;
    const [timePart, ampm] = base.split(' ');
    const [bh, bm] = timePart.split(':').map(Number);
    const year = leagueConfig?.year || new Date().getFullYear();
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDt = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    const events = [];
    schedule.forEach(wk => {
      if (wk.rainedOut) return;
      const myMatch = wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id);
      if (!myMatch) return;
      const res = matchResults.find(r => r.week === wk.week && r.team1Id === myMatch.team1 && r.team2Id === myMatch.team2);
      if (res) return;

      const origIdx = wk.matches.indexOf(myMatch);
      const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
      const oppTeam = teams.find(t => t.id === oppId);
      const side = wk.side || getWeekSide(wk.week);
      const sideLabel = side === 'front' ? 'Front 9' : 'Back 9';

      const totalMins = (ampm === 'PM' && bh !== 12 ? bh + 12 : bh) * 60 + bm + origIdx * interval;
      const teeHr = Math.floor(totalMins / 60);
      const teeMin = totalMins % 60;
      const teeTimeStr = fmtTeeTime(origIdx);

      let startDate;
      if (wk.date) {
        const [mon, day] = wk.date.split('/').map(Number);
        if (mon && day) startDate = new Date(year, mon - 1, day, teeHr, teeMin);
      }
      if (!startDate) {
        const months = { 'Jan':0,'Feb':1,'Mar':2,'Apr':3,'May':4,'Jun':5,'Jul':6,'Aug':7,'Sep':8,'Oct':9,'Nov':10,'Dec':11 };
        const parts = (wk.date || "").split(' ');
        if (parts.length === 2) {
          const m = months[parts[0]];
          const d = parseInt(parts[1]);
          if (m !== undefined && d) startDate = new Date(year, m, d, teeHr, teeMin);
        }
      }
      if (!startDate) return;

      const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
      events.push(
        `BEGIN:VEVENT\r\n` +
        `DTSTART:${fmtDt(startDate)}\r\n` +
        `DTEND:${fmtDt(endDate)}\r\n` +
        `SUMMARY:MnQ Golf - Week ${wk.week} vs ${lastNamesOnly(oppTeam?.name || 'TBD')}\r\n` +
        `DESCRIPTION:${sideLabel} | Tee Time: ${teeTimeStr}\\nVs: ${oppTeam?.name || 'TBD'}\r\n` +
        `END:VEVENT\r\n`
      );
    });

    if (!events.length) return;
    const cal = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MnQ Golf//EN\r\n${events.join('')}END:VCALENDAR`;
    const blob = new Blob([cal], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mnq-golf-schedule.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── My Schedule compact row ──
  const renderMyWeek = (wk, isDone) => {
    const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
    const isPlayoff = wk.isPlayoff === true;
    const myMatch = !isSeeded ? wk.matches.find(m => m.team1 === myTeam.id || m.team2 === myTeam.id) : null;
    const origIdx = myMatch ? wk.matches.indexOf(myMatch) : 0;
    const side = wk.side || getWeekSide(wk.week);
    const isRainedOut = wk.rainedOut === true;
    const res = myMatch ? matchResults.find(r => r.week === wk.week && r.team1Id === myMatch.team1 && r.team2Id === myMatch.team2) : null;
    const isComplete = isWeekComplete(wk);

    let oppName = "TBD";
    if (myMatch) {
      const oppId = myMatch.team1 === myTeam.id ? myMatch.team2 : myMatch.team1;
      const oppTeam = teams.find(t => t.id === oppId);
      oppName = lastNamesOnly(oppTeam?.name || "TBD");
    }

    const teeTimeShort = myMatch ? fmtTeeTime(origIdx).replace(/\s*(AM|PM)$/i, '') : "—";

    // Parse the match result into two parts so the Schedule column can stack
    // them on two lines: W/L/T on top, margin detail (like "1UP", "3&1", "TIE"
    // plus tiebreaker label) below. Keeps the column narrow and scannable.
    let wlLetter = "";
    let detailText = "";
    if (res) {
      const isT1 = myMatch.team1 === myTeam.id;
      const myPts = isT1 ? res.team1Points : res.team2Points;
      const oppPts = isT1 ? res.team2Points : res.team1Points;
      wlLetter = myPts > oppPts ? "W" : myPts < oppPts ? "L" : "T";
      // Detail lines:
      //   "TIED"              -> no detail (plain T)
      //   "TIE (Hole N)"      -> "Hole N" (playoff tiebreaker, the T is already on top)
      //   "1UP" / "3&1"       -> shown as-is
      const raw = res.matchResultText || `${myPts}-${oppPts}`;
      if (raw === "TIED") {
        detailText = "";
      } else {
        const tbMatch = raw.match(/^TIE\s*\(([^)]+)\)\s*$/i);
        if (tbMatch) {
          detailText = tbMatch[1];
        } else {
          detailText = raw;
        }
      }
    }

    const resultColor = wlLetter === "W" ? K.matchGrn : wlLetter === "L" ? K.red : K.t2;

    const isCurrent = wk.week === schedule[currentWeekIdx]?.week;

    return (
      <div key={wk.week} style={{ borderRadius: CARD_RADIUS, overflow: "hidden", border: `1px solid ${isCurrent && !isRainedOut ? K.matchGrn + "40" : K.bdr}` }}>
        <button
          onClick={() => {
            if (isComplete && myMatch && res) {
              toggleMatchExpand(wk.week, 0);
            }
          }}
          style={{
            display: "flex", alignItems: "center", padding: "11px 14px", width: "100%",
            background: isCurrent && !isRainedOut ? K.matchGrn + "12" : K.card,
            border: "none", cursor: isComplete && res ? "pointer" : "default",
            opacity: isRainedOut ? 0.5 : 1, gap: 10, textAlign: "left",
          }}
        >
          <div style={{ width: 22, fontSize: 14, fontWeight: 700, color: K.t1, flexShrink: 0 }}>{wk.week}</div>
          <div style={{ width: 52, fontSize: 12, fontWeight: 600, color: K.t1, flexShrink: 0 }}>{wk.date || "—"}</div>
          <div style={{ width: 44, flexShrink: 0, color: isRainedOut ? K.warn : isComplete ? resultColor : isSeeded ? K.t3 : K.act }}>
            {isRainedOut ? (
              <span style={{ fontSize: 14, fontWeight: 700 }}>—</span>
            ) : isComplete ? (
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: resultColor }}>{wlLetter}</span>
                {detailText && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: resultColor, marginTop: 1 }}>{detailText}</span>
                )}
              </div>
            ) : isSeeded ? (
              <span style={{ fontSize: 14, fontWeight: 700 }}>—</span>
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700 }}>{teeTimeShort}</span>
            )}
          </div>
          <div style={{ width: 38, fontSize: 11, fontWeight: 600, color: "#3b82f6", flexShrink: 0 }}>
            {isRainedOut ? "" : side === 'front' ? 'Front' : 'Back'}
          </div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: isRainedOut ? K.warn : isSeeded ? K.t3 : K.t1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {isRainedOut ? "RAIN" : isSeeded ? (() => {
              if (isPlayoff) {
                const pRound = schedule.filter(s => s.isPlayoff === true && s.week <= wk.week).length;
                const roundName = (leagueConfig?.playoffRounds || [])[pRound - 1]?.name;
                return roundName ? `${roundName} — TBD` : "Playoff — TBD";
              }
              // Show configured seed matchup opponent if available
              const seededRegWeeks = schedule.filter(s => s.seeded === true && !s.isPlayoff).sort((a, b) => a.week - b.week);
              const seededIdx = seededRegWeeks.findIndex(s => s.week === wk.week);
              const customWeeks = leagueConfig?.customSeedWeeks;
              const weekPairs = customWeeks && customWeeks[seededIdx];
              if (weekPairs && myTeam) {
                const seedOrder = leagueConfig?.lockedSeeds || (() => {
                  const pts = {};
                  teams.forEach(t => { pts[t.id] = 0; });
                  matchResults.forEach(r => {
                    if (pts[r.team1Id] !== undefined) pts[r.team1Id] += (r.team1Points || 0);
                    if (pts[r.team2Id] !== undefined) pts[r.team2Id] += (r.team2Points || 0);
                  });
                  return Object.entries(pts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
                })();
                const mySeed = seedOrder.indexOf(myTeam.id) + 1;
                if (mySeed > 0) {
                  const myPair = weekPairs.find(p => p.s1 === mySeed || p.s2 === mySeed);
                  if (myPair) {
                    const oppSeed = myPair.s1 === mySeed ? myPair.s2 : myPair.s1;
                    const oppTeamId = seedOrder[oppSeed - 1];
                    const oppTeam = teams.find(t => t.id === oppTeamId);
                    if (oppTeam) return (
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: K.logoBright, background: K.logoBright + "18", border: `1px solid ${K.logoBright}25`, borderRadius: 3, padding: "0 3px", lineHeight: "16px" }}>#{mySeed}</span>
                        <span style={{ color: K.t3 }}>vs</span>
                        <span style={{ fontSize: 9, fontWeight: 800, color: K.logoBright, background: K.logoBright + "18", border: `1px solid ${K.logoBright}25`, borderRadius: 3, padding: "0 3px", lineHeight: "16px" }}>#{oppSeed}</span>
                        <span>{lastNamesOnly(oppTeam.name)}</span>
                      </span>
                    );
                  }
                }
              }
              return "Seeded — TBD";
            })() : oppName}
          </div>
          {isComplete && res && (
            <div style={{ flexShrink: 0, color: K.t3, fontSize: 9 }}>{expandedMatchKey === `${wk.week}_0` ? "▾" : "›"}</div>
          )}
        </button>
        {expandedMatchKey === `${wk.week}_0` && isComplete && myMatch && res && (
          <div style={{ padding: "2px 8px 10px", background: K.card, borderTop: `1px solid ${K.bdr}30` }}>
            {renderMatchScorecard(wk, myMatch, res)}
          </div>
        )}
      </div>
    );
  };

  // ── Mini scorecard for expanded match ──
  const renderMatchScorecard = (wk, m, res) => {
    if (!course || !res) return null;
    const side = wk.side || getWeekSide(wk.week);
    const pars = side === 'front' ? course.frontPars : course.backPars;
    const hcps = side === 'front' ? course.frontHcps : course.backHcps;
    const wkScores = matchScores[wk.week];
    if (!wkScores) return <div style={{ padding: 10, textAlign: "center", color: K.t3, fontSize: 11 }} className="pu">Loading scores...</div>;

    const t1 = teams.find(t => t.id === m.team1);
    const t2 = teams.find(t => t.id === m.team2);
    const t1Pids = [t1?.player1, t1?.player2].filter(Boolean);
    const t2Pids = [t2?.player1, t2?.player2].filter(Boolean);

    // Render-time helpers — most score reading and stroke calculation now
    // delegates to lib/matchCalc.js so absent-handling stays consistent across
    // every view (Live Scoring, Schedule, Standings). The only locals kept are
    // utility wrappers that bind the component's pars/hcps/players closures so
    // the call sites stay readable.
    const getInitials = (pid) => { const p = players.find(pl => pl.id === pid); return p ? p.name.split(' ').map(n => n[0]).join('') : "?"; };
    const getHcp = (pid) => { const p = players.find(pl => pl.id === pid); return p ? Math.round(p.handicapIndex || 0) : 0; };
    const isAbsent = (pid) => wkScores[`w${wk.week}_p${pid}_habsent`] === 1;
    const getStrokes = (pid, h) => getStrokesForHole({ pid, h, players, hcps });
    const getScore = (pid, h) => readScoreEffective({
      pid, h, week: wk.week, holeScores: wkScores,
      t1Pids, t2Pids, pars, hcps, players,
    });

    // Compute hole results + running status
    const holeResults = [];
    for (let h = 0; h < 9; h++) {
      let n1 = 0, n2 = 0;
      t1Pids.forEach(pid => { n1 += getScore(pid, h) - getStrokes(pid, h); });
      t2Pids.forEach(pid => { n2 += getScore(pid, h) - getStrokes(pid, h); });
      holeResults.push(n1 < n2 ? 1 : n2 < n1 ? -1 : 0);
    }
    const runningStatus = []; let cum = 0;
    holeResults.forEach(r => { cum += r; runningStatus.push(cum); });
    let clinchHole = null, clinchText = null;
    for (let h = 0; h < 9; h++) {
      const lead = Math.abs(runningStatus[h]); const rem = 8 - h;
      if (lead > rem) { clinchHole = h; clinchText = rem > 0 ? `${lead}&${rem}` : `${lead}UP`; break; }
    }

    // Swap so user's team is on top
    const isMyT2 = myTeam && m.team2 === myTeam.id;
    const dispT1Pids = isMyT2 ? t2Pids : t1Pids;
    const dispT2Pids = isMyT2 ? t1Pids : t2Pids;
    const dispHR = isMyT2 ? holeResults.map(r => -r) : holeResults;
    const dispRS = isMyT2 ? runningStatus.map(r => -r) : runningStatus;
    const dispCH = clinchHole;
    const dispCT = clinchText;

    const sc = SharedScorecard({
      pars, side, hcps, team1Pids: dispT1Pids, team2Pids: dispT2Pids,
      getScore, getStrokes, getHcp, getInitials, isAbsent,
      holeResults: dispHR, runningStatus: dispRS,
      clinchHole: dispCH, clinchText: dispCT,
      variant: "allMatches", showTotals: true, matchGrn: K.matchGrn,
    });

    return (<>
      <div style={{ margin: "4px 0 2px" }}>
        <sc.HoleRow />
        <sc.ParRow />
        {dispT1Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT1Pids} isTeam1Side={true} />
        <sc.MatchRow />
        {dispT2Pids.map(pid => <sc.PlayerRow key={pid} pid={pid} />)}
        <sc.TeamNetRow pids={dispT2Pids} isTeam1Side={false} />
      </div>
      {isComm && saveScore && (
        <button onClick={() => openEditScores(wk, m, res)} style={{ width: "100%", padding: "6px 0", marginTop: 4, borderRadius: 6, background: K.warn + "15", border: `1px solid ${K.warn}40`, color: K.warn, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          Edit Scores
        </button>
      )}
    </>);
  };

  // ── Full week view ──
  const renderWeek = (wk, isDone) => {
    const isPlayoff = wk.isPlayoff === true;
    const weekComplete = isWeekComplete(wk);
    const isRainedOut = wk.rainedOut === true;
    const isSeeded = wk.seeded === true && (!wk.matches || wk.matches.length === 0);
    // Show seed badges on seeded (non-RR) and playoff weeks. RR weeks don't get seeds
    // because every team plays every other team equally, so seeds aren't meaningful.
    const showSeeds = (wk.seeded === true) || (wk.isPlayoff === true);
    const side = wk.side || getWeekSide(wk.week);
    const isExp = getExpanded(wk.week);

    const matches = myOnly
      ? wk.matches.filter(m => myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id))
      : wk.matches;

    // Gray header background for completed expanded weeks
    const headerBg = isExp && weekComplete && !isRainedOut ? K.inp : K.card;

    return (
      <div key={wk.week}>
        <button onClick={() => toggleWeek(wk.week)} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
          background: headerBg, padding: "10px 14px", cursor: "pointer", textAlign: "left",
          borderRadius: isExp ? `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` : CARD_RADIUS,
          border: `1px solid ${isRainedOut ? K.warn + "40" : weekComplete ? K.bdr : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
          borderBottom: isExp ? "none" : undefined,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: NAME_SIZE, fontWeight: 700, color: K.t1, minWidth: 90 }}>
              Week {wk.week}
            </span>
            {wk.date && <span style={{ fontSize: 12, color: K.t3 }}>{wk.date}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isRainedOut && <Pill color={K.warn} style={{ fontSize: 9 }}>RAIN OUT</Pill>}
            {wk.makeupFor && <Pill color={K.teal} style={{ fontSize: 9 }}>MAKEUP</Pill>}
            {!isRainedOut && <Pill color={K.logoBright} style={{ fontSize: 9 }}>{side === 'front' ? 'FRONT 9' : 'BACK 9'}</Pill>}
            {isSeeded && !isRainedOut && <Pill color={K.acc} style={{ fontSize: 9 }}>SEEDED</Pill>}
            {isPlayoff && !isRainedOut && <Pill color={K.warn} style={{ fontSize: 9 }}>PLAYOFF</Pill>}
            {weekComplete && !isRainedOut && <Pill color={K.grn} style={{ fontSize: 9 }}>FINAL</Pill>}
            <span style={{ color: K.t3, fontSize: CHEVRON_SIZE, marginLeft: 2 }}>{isExp ? "▾" : "›"}</span>
          </div>
        </button>

        {isExp && isRainedOut && (
          <div style={{
            background: K.inp, borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            border: `1px solid ${K.warn}40`, borderTop: "none", padding: "12px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 13, color: K.warn, fontWeight: 600 }}>Rained Out</div>
            <div style={{ fontSize: 11, color: K.t3, marginTop: 2 }}>Matchups rescheduled to makeup week</div>
          </div>
        )}

        {isExp && !isRainedOut && isSeeded && (() => {
          let roundTitle = "Seeded Matchups";
          if (isPlayoff) {
            const pRound = schedule.filter(s => s.isPlayoff === true && s.week <= wk.week).length;
            const roundName = (leagueConfig?.playoffRounds || [])[pRound - 1]?.name;
            roundTitle = roundName || "Playoff Matchups";
          }
          return (
          <div style={{
            background: K.inp, borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            border: `1px solid ${K.bdr}`, borderTop: "none", padding: "12px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 13, color: K.t2, fontWeight: 600 }}>{roundTitle}</div>
            <div style={{ fontSize: 11, color: K.t3, marginTop: 2 }}>Matchups determined by standings — TBD</div>
          </div>
          );
        })()}

        {isExp && !isRainedOut && !isSeeded && (
          <div style={{
            background: K.inp, borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
            border: `1px solid ${weekComplete ? K.bdr : wk.week === schedule[currentWeekIdx]?.week ? K.act + "40" : K.bdr}`,
            borderTop: "none", padding: "6px 8px",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {matches.map((m, mi) => {
                const rawT1 = teams.find(t => t.id === m.team1);
                const rawT2 = teams.find(t => t.id === m.team2);
                const res = matchResults.find(r => r.week === wk.week && r.team1Id === m.team1 && r.team2Id === m.team2);
                const isMyMatch = myTeam && (m.team1 === myTeam.id || m.team2 === myTeam.id);
                const origIdx = wk.matches.indexOf(m);
                const isMatchExp = expandedMatchKey === `${wk.week}_${mi}`;

                const swapped = isMyMatch && m.team2 === myTeam.id;
                const t1 = swapped ? rawT2 : rawT1;
                const t2 = swapped ? rawT1 : rawT2;
                const score1 = res ? (swapped ? res.team2Points : res.team1Points) : null;
                const score2 = res ? (swapped ? res.team1Points : res.team2Points) : null;

                // Match result color: TIED = gray, everything else = black
                const resultColor = res && res.matchResultText === "TIED" ? K.t3 : K.t1;

                return (
                  <div key={mi} style={{ background: K.card, borderRadius: 8, border: isMyMatch ? `1.5px solid ${K.act}` : `1px solid ${K.bdr}`, overflow: "hidden" }}>
                    <button onClick={() => res ? toggleMatchExpand(wk.week, mi) : null} style={{ width: "100%", padding: "8px 10px", display: "flex", alignItems: "center", background: "transparent", border: "none", cursor: res ? "pointer" : "default", textAlign: "left" }}>
                      {/* Seed badge — left team */}
                      {showSeeds && (
                        <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: K.logoBright, marginRight: 4 }}>
                          {seedMap[t1?.id] || "?"}
                        </div>
                      )}
                      {/* Left team */}
                      <div style={{ flex: 1, textAlign: "right", paddingRight: res && score1 > score2 ? 8 : 18, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <div style={{ fontSize: NAME_SIZE, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player1)}</div>
                        <div style={{ fontSize: NAME_SIZE, fontWeight: res && score1 > score2 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t1?.player2)}</div>
                        <div style={{ fontSize: 12, color: K.t3, fontWeight: 600, marginTop: 2 }}>{fmtRecord(t1?.id, wk.week)}</div>
                      </div>
                      {/* Winner triangle left */}
                      {res && score1 > score2 && (
                        <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, marginRight: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(-90deg)" }}>▲</div>
                      )}
                      {/* Center — match result or tee time. Tiebreaker results like
                          "TIE (Hole 5)" display as stacked lines: big TIE on top, small
                          hole label below. Width kept generous so long labels don't
                          crowd against the team names on either side. */}
                      <div style={{ textAlign: "center", minWidth: 82, flexShrink: 0, padding: "0 4px" }}>
                        {res ? (() => {
                          const raw = res.matchResultText || `${score1}–${score2}`;
                          const tbMatch = raw.match(/^TIE\s*\(([^)]+)\)\s*$/i);
                          if (tbMatch) {
                            return (
                              <>
                                <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: 800, color: resultColor, letterSpacing: .5, lineHeight: 1 }}>TIE</div>
                                <div style={{ fontSize: 10, fontWeight: 700, color: K.t3, letterSpacing: .5, textTransform: "uppercase", marginTop: 2, lineHeight: 1.1 }}>{tbMatch[1]}</div>
                              </>
                            );
                          }
                          return (
                            <div style={{ fontSize: HERO_NUM_SIZE, fontWeight: 800, color: resultColor, letterSpacing: .5 }}>{raw}</div>
                          );
                        })() : (
                          <div style={{ fontSize: 18, fontWeight: 800, color: K.act, letterSpacing: .3 }}>{fmtTeeTime(origIdx)}</div>
                        )}
                      </div>
                      {/* Winner triangle right */}
                      {res && score2 > score1 && (
                        <div style={{ color: K.matchGrn, fontSize: 15, fontWeight: 800, marginLeft: 2, flexShrink: 0, lineHeight: 1, transform: "rotate(90deg)" }}>▲</div>
                      )}
                      {/* Right team */}
                      <div style={{ flex: 1, textAlign: "left", paddingLeft: res && score2 > score1 ? 8 : 18, overflow: "hidden" }}>
                        <div style={{ fontSize: NAME_SIZE, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player1)}</div>
                        <div style={{ fontSize: NAME_SIZE, fontWeight: res && score2 > score1 ? 700 : 600, color: K.t1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dn(t2?.player2)}</div>
                        <div style={{ fontSize: 12, color: K.t3, fontWeight: 600, marginTop: 2 }}>{fmtRecord(t2?.id, wk.week)}</div>
                      </div>
                      {/* Seed badge — right team */}
                      {showSeeds && (
                        <div style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, background: K.logoBright + "20", border: `1px solid ${K.logoBright}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: K.logoBright, marginLeft: 4 }}>
                          {seedMap[t2?.id] || "?"}
                        </div>
                      )}
                      {/* Expand chevron — only for finalized matches */}
                      {res && (
                        <div style={{ flexShrink: 0, marginLeft: 4, color: K.t3, fontSize: 10, transform: isMatchExp ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</div>
                      )}
                    </button>
                    {/* Expanded match scorecard */}
                    {isMatchExp && (
                      <div style={{ padding: "0 6px 8px", borderTop: `1px solid ${K.bdr}30` }}>
                        {renderMatchScorecard(wk, m, res)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderer = myOnly ? renderMyWeek : renderWeek;

  return (
    <div>

      {/* Filter bar — single row */}
      <div style={{ display: "flex", gap: 5, marginBottom: 14, alignItems: "center" }}>
        {myTeam && (
          <button onClick={() => { setMyOnly(true); setShowAll(true); }} style={{
            padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
            background: myOnly ? K.acc : K.card, color: myOnly ? K.bg : K.t2,
            border: `1px solid ${myOnly ? K.acc : K.bdr}`, whiteSpace: "nowrap",
          }}>My Schedule</button>
        )}
        <button onClick={() => { setShowAll(true); setMyOnly(false); }} style={{
          padding: "7px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600,
          background: !myOnly ? K.acc : K.card, color: !myOnly ? K.bg : K.t2,
          border: `1px solid ${!myOnly ? K.acc : K.bdr}`, whiteSpace: "nowrap",
        }}>Full League</button>

        {myOnly && (
          <button onClick={addAllToCalendar} style={{
            display: "flex", alignItems: "center", gap: 3,
            padding: "6px 8px", borderRadius: 6, cursor: "pointer",
            background: K.act + "12", border: `1px solid ${K.act}30`, color: K.act,
            fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", marginLeft: "auto",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Add All
          </button>
        )}
      </div>

      {/* My Schedule column header — upcoming */}
      {myOnly && weeksToShow.upcoming.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", padding: "0 14px 6px", fontSize: 9, color: K.t3, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8, gap: 10 }}>
          <div style={{ width: 22 }}>Wk</div>
          <div style={{ width: 52 }}>Date</div>
          <div style={{ width: 40 }}>Time</div>
          <div style={{ width: 38 }}>Side</div>
          <div style={{ flex: 1 }}>Opponent</div>
        </div>
      )}

      {/* Upcoming weeks */}
      {weeksToShow.upcoming.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
          {weeksToShow.upcoming.map(wk => renderer(wk, false))}
        </div>
      )}

      {/* Complete weeks */}
      {weeksToShow.complete.length > 0 && (
        <div style={{ marginTop: weeksToShow.upcoming.length > 0 ? 20 : 0 }}>
          {(showAll || myOnly) && weeksToShow.upcoming.length > 0 && (
            <SubLabel color={K.t3} style={{ marginBottom: 8 }}>Complete</SubLabel>
          )}
          {/* My Schedule column header — complete */}
          {myOnly && (
            <div style={{ display: "flex", alignItems: "center", padding: "0 14px 6px", fontSize: 9, color: K.t3, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8, gap: 10 }}>
              <div style={{ width: 22 }}>Wk</div>
              <div style={{ width: 52 }}>Date</div>
              <div style={{ width: 40 }}>Result</div>
              <div style={{ width: 38 }}>Side</div>
              <div style={{ flex: 1 }}>Opponent</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: LIST_GAP }}>
            {weeksToShow.complete.map(wk => renderer(wk, true))}
          </div>
        </div>
      )}

      {weeksToShow.upcoming.length === 0 && weeksToShow.complete.length === 0 && (
        <EmptyState icon="calendar" title="No matches to show" />
      )}

      {/* ═══ Commissioner Edit Scores Popup ═══ */}
      {editingMatch && (() => {
        const { wk, m, res } = editingMatch;
        const side = wk.side || getWeekSide(wk.week);
        const pars = course ? (side === 'front' ? course.frontPars : course.backPars) : [4,4,4,3,5,4,4,3,5];
        const t1 = teams.find(t => t.id === m.team1);
        const t2 = teams.find(t => t.id === m.team2);
        const t1Pids = [t1?.player1, t1?.player2].filter(Boolean);
        const t2Pids = [t2?.player1, t2?.player2].filter(Boolean);
        const allPids = [...t1Pids, ...t2Pids];
        const getName = (pid) => { const p = players.find(pl => pl.id === pid); return p ? p.name.split(' ').pop() : "?"; };
        const getInitials = (pid) => { const p = players.find(pl => pl.id === pid); return p ? p.name.split(' ').map(n => n[0]).join('').toUpperCase() : "?"; };
        const getHcp = (pid) => { const p = players.find(pl => pl.id === pid); return p ? Math.round(p.handicapIndex || 0) : 0; };
        const setS = (pid, h, val) => setEditScores(prev => ({ ...prev, [`${pid}_${h}`]: val }));
        const getS = (pid, h) => editScores[`${pid}_${h}`] || 0;
        const isAbs = (pid) => !!editAbsent[pid];
        const toggleAbsent = (pid) => setEditAbsent(prev => ({ ...prev, [pid]: !prev[pid] }));
        // Save is allowed when every PRESENT player has a score for every hole.
        // Absent players are skipped — their teammate's score substitutes during
        // recalculation (handled by matchCalc), so the row staying blank is fine.
        const allFilled = allPids.every(pid => {
          if (isAbs(pid)) return true;
          for (let h = 0; h < 9; h++) if (getS(pid, h) <= 0) return false;
          return true;
        });

        // Popup positioning: `position: fixed` with a small top offset so the
        // popup is ALWAYS visible regardless of where the user scrolled before
        // tapping Edit Scores. maxHeight + overflowY:auto keep a tall popup
        // contained — if its content exceeds the viewport, the inner card
        // scrolls rather than overflowing off-screen. Earlier versions tried
        // to anchor to the clicked button's document Y; that left the popup
        // stuck off-screen on long pages, which is the bug this revision fixes.
        return (<>
          <div onClick={() => setEditingMatch(null)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 500 }} />
          <div data-popup style={{
            position: "fixed", top: 20, left: 0, right: 0, bottom: 20,
            zIndex: 550,
            display: "flex", justifyContent: "center", alignItems: "flex-start",
            padding: "0 10px",
            pointerEvents: "none",
          }}>
            <div onClick={e => e.stopPropagation()} data-popup-scroll style={{
              background: K.bg, border: `1px solid ${K.bdr}`, borderRadius: 14,
              padding: "14px 12px", width: "100%", maxWidth: 460,
              maxHeight: "100%", overflowY: "auto", overscrollBehavior: "contain",
              pointerEvents: "auto",
              boxShadow: "0 12px 40px rgba(0,0,0,.4)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: K.t1 }}>Edit Scores — Week {wk.week}</div>
                <button onClick={() => setEditingMatch(null)} style={{ background: "none", border: "none", color: K.t3, fontSize: 18, cursor: "pointer", padding: "0 4px" }}>✕</button>
              </div>

              {/* Hole header */}
              <div style={{ display: "flex", marginBottom: 2, paddingLeft: 64 }}>
                {Array.from({ length: 9 }, (_, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 700, color: K.t3 }}>{side === 'front' ? i + 1 : i + 10}</div>
                ))}
              </div>
              {/* Par row */}
              <div style={{ display: "flex", marginBottom: 8, paddingLeft: 64 }}>
                {pars.map((p, i) => (
                  <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 10, fontWeight: 600, color: K.t2 }}>{p}</div>
                ))}
              </div>

              {/* Player score rows — two-line layout: top line is initials +
                  name + handicap pill + absent toggle; bottom line is the
                  9 score input cells. This stops the player name from eating
                  into the score input area and exposes the handicap reliably. */}
              {[...t1Pids, null, ...t2Pids].map((pid, idx) => {
                if (pid === null) return <div key="sep" style={{ height: 1, background: K.bdr + "40", margin: "8px 0" }} />;
                const absent = isAbs(pid);
                return (
                  <div key={pid} style={{ marginBottom: 10, opacity: absent ? 0.55 : 1 }}>
                    {/* Player meta row — initials avatar, name, hcp, absent toggle */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: "50%",
                        background: absent ? K.red + "20" : K.acc + "20",
                        color: absent ? K.red : K.acc,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 800, letterSpacing: -.2,
                        flexShrink: 0,
                      }}>{getInitials(pid)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: K.t1, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {getName(pid)}
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: K.t3,
                        background: K.inp, padding: "2px 7px", borderRadius: 10,
                        flexShrink: 0,
                      }}>HCP {getHcp(pid)}</div>
                      <button
                        onClick={() => toggleAbsent(pid)}
                        style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: .3,
                          padding: "3px 9px", borderRadius: 10,
                          background: absent ? K.red : "transparent",
                          color: absent ? K.bg : K.t3,
                          border: `1px solid ${absent ? K.red : K.bdr}`,
                          cursor: "pointer", flexShrink: 0,
                          textTransform: "uppercase",
                        }}
                        title={absent ? "Click to mark present" : "Click to mark absent"}
                      >
                        {absent ? "✓ Absent" : "Mark Absent"}
                      </button>
                    </div>
                    {/* Score input row */}
                    <div style={{ display: "flex", paddingLeft: 64 }}>
                      {Array.from({ length: 9 }, (_, h) => {
                        const val = getS(pid, h);
                        const par = pars[h];
                        const diff = val > 0 ? val - par : 0;
                        const color = val <= 0 ? K.t3 : diff < 0 ? K.red : K.t1;
                        return (
                          <div key={h} style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                            <input
                              type="number"
                              value={val || ""}
                              onChange={e => setS(pid, h, parseInt(e.target.value) || 0)}
                              disabled={absent}
                              style={{
                                width: "100%", maxWidth: 32, height: 30, textAlign: "center", fontSize: 14, fontWeight: 700,
                                background: absent ? "transparent" : K.inp,
                                border: `1px solid ${absent ? K.bdr + "40" : K.bdr}`,
                                borderRadius: 4, color,
                                padding: 0, outline: "none",
                                cursor: absent ? "not-allowed" : "text",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Save / Cancel */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={prepareEditedScores} disabled={!allFilled || saving} style={{ flex: 1, padding: 10, borderRadius: 8, background: allFilled && !saving ? K.warn : K.inp, border: allFilled && !saving ? "none" : `1px solid ${K.bdr}`, color: allFilled && !saving ? K.bg : K.t3, fontSize: 13, fontWeight: 700, cursor: allFilled && !saving ? "pointer" : "default" }}>
                  {saving ? "Saving..." : "Save & Re-sign"}
                </button>
                <button onClick={() => setEditingMatch(null)} style={{ padding: "10px 16px", borderRadius: 8, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t2, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>);
      })()}

      {/* ── Edit confirmation popup ──
          Renders OVER the edit popup when pendingEdits is set. Shows:
            - Match-result diff (W/L/T flip, points, winner)
            - Per-hole score changes
            - Absent-flag changes
          Confirm → commitEditedScores persists the changes. Cancel → drops
          pendingEdits and returns to the edit popup so the commissioner can
          adjust further. The popup uses the same fixed-viewport positioning
          as the edit popup so it's always visible. */}
      {pendingEdits && (() => {
        const { diff, changedScores, changedAbsents } = pendingEdits;
        const hasResultChange = Object.keys(diff).length > 0;
        return (<>
          <div onClick={() => setPendingEdits(null)} data-popup style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 600 }} />
          <div data-popup style={{
            position: "fixed", top: 20, left: 0, right: 0, bottom: 20,
            zIndex: 650,
            display: "flex", justifyContent: "center", alignItems: "flex-start",
            padding: "0 10px",
            pointerEvents: "none",
          }}>
            <div onClick={e => e.stopPropagation()} data-popup-scroll style={{
              background: K.bg, border: `1px solid ${K.warn}`, borderRadius: 14,
              padding: "16px 14px", width: "100%", maxWidth: 460,
              maxHeight: "100%", overflowY: "auto", overscrollBehavior: "contain",
              pointerEvents: "auto",
              boxShadow: `0 12px 40px ${K.warn}40`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: K.warn, letterSpacing: .3 }}>
                  Confirm Score Edit
                </div>
                <button onClick={() => setPendingEdits(null)} style={{ background: "none", border: "none", color: K.t3, fontSize: 18, cursor: "pointer", padding: "0 4px" }}>✕</button>
              </div>

              {/* Lead-in summary */}
              <div style={{ fontSize: 12, color: K.t2, marginBottom: 14, lineHeight: 1.5 }}>
                {hasResultChange
                  ? "Saving these changes will update the match result. Standings and schedule will reflect the new outcome."
                  : "Score values will be updated. Match result is unchanged."}
              </div>

              {/* Match result diff */}
              {hasResultChange && (
                <div style={{ background: K.warn + "12", border: `1px solid ${K.warn}40`, borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: K.warn, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Match result</div>
                  {diff.result && (
                    <div style={{ fontSize: 12, color: K.t1, marginBottom: 4 }}>
                      <span style={{ color: K.t3 }}>Result: </span>
                      <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.result.from}</span>
                      <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                      <span style={{ fontWeight: 700 }}>{diff.result.to}</span>
                    </div>
                  )}
                  {diff.winner && (
                    <div style={{ fontSize: 12, color: K.t1, marginBottom: 4 }}>
                      <span style={{ color: K.t3 }}>Winner: </span>
                      <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.winner.from}</span>
                      <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                      <span style={{ fontWeight: 700 }}>{diff.winner.to}</span>
                    </div>
                  )}
                  {diff.t1Points && (
                    <div style={{ fontSize: 12, color: K.t1, marginBottom: 4 }}>
                      <span style={{ color: K.t3 }}>{lastNamesOnly(teams.find(t => t.id === pendingEdits.t1.id)?.name || "Team 1")} points: </span>
                      <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.t1Points.from}</span>
                      <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                      <span style={{ fontWeight: 700 }}>{diff.t1Points.to}</span>
                    </div>
                  )}
                  {diff.t2Points && (
                    <div style={{ fontSize: 12, color: K.t1 }}>
                      <span style={{ color: K.t3 }}>{lastNamesOnly(teams.find(t => t.id === pendingEdits.t2.id)?.name || "Team 2")} points: </span>
                      <span style={{ textDecoration: "line-through", color: K.t3 }}>{diff.t2Points.from}</span>
                      <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                      <span style={{ fontWeight: 700 }}>{diff.t2Points.to}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Score changes */}
              {changedScores.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                    Score changes ({changedScores.length})
                  </div>
                  <div style={{ background: K.inp, borderRadius: 8, padding: "8px 10px", fontSize: 11, color: K.t2, lineHeight: 1.7 }}>
                    {changedScores.map((c, i) => (
                      <div key={i}>
                        <span style={{ color: K.t1, fontWeight: 700 }}>{c.playerName}</span>
                        <span style={{ color: K.t3 }}> · Hole {c.hole}: </span>
                        <span style={{ textDecoration: "line-through", color: K.t3 }}>{c.oldVal || "—"}</span>
                        <span style={{ margin: "0 6px", color: K.t3 }}>→</span>
                        <span style={{ fontWeight: 700, color: K.t1 }}>{c.newVal}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Absent flag changes */}
              {changedAbsents.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: K.t3, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
                    Attendance changes
                  </div>
                  <div style={{ background: K.inp, borderRadius: 8, padding: "8px 10px", fontSize: 11, color: K.t2, lineHeight: 1.7 }}>
                    {changedAbsents.map((c, i) => (
                      <div key={i}>
                        <span style={{ color: K.t1, fontWeight: 700 }}>{c.playerName}</span>
                        <span style={{ color: K.t3 }}> marked </span>
                        <span style={{ fontWeight: 700, color: c.newAbsent ? K.red : K.grn }}>
                          {c.newAbsent ? "Absent" : "Present"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirm / Cancel */}
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button
                  onClick={commitEditedScores}
                  disabled={saving}
                  style={{
                    flex: 1, padding: "12px",
                    borderRadius: 8,
                    background: saving ? K.inp : K.warn,
                    border: "none",
                    color: saving ? K.t3 : K.bg,
                    fontSize: 13, fontWeight: 800, letterSpacing: .3,
                    cursor: saving ? "default" : "pointer",
                  }}
                >
                  {saving ? "Saving..." : "Confirm & Save"}
                </button>
                <button
                  onClick={() => setPendingEdits(null)}
                  disabled={saving}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 8,
                    background: K.inp, border: `1px solid ${K.bdr}`,
                    color: K.t2,
                    fontSize: 13, fontWeight: 700,
                    cursor: saving ? "default" : "pointer",
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        </>);
      })()}
    </div>
  );
}
