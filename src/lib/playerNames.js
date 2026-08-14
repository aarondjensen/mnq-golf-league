// ══════════════════════════════════════════════════════════════════
//  playerNames — how a golfer is written on screen.
// ══════════════════════════════════════════════════════════════════
//
// Display-name formatting only. WBC keeps the same concern in a file of the
// same name.
//
// Split out of lib/league.js, which was itself split out of theme.jsx. One
// 861-line file holding handicaps, standings, seeding, brackets and score
// classification was a big improvement on 1,108 mixed ones, and still coarser
// than Bourbon Cup and WBC, which both split their domain by concern. These
// clusters barely referenced each other, so the split is along seams that were
// already there.
//
// Pure: no React, no Firestore, no DOM.

// ── Shared utility: extract last names from team name ──
export function lastNamesOnly(teamName) {
  if (!teamName) return "";
  return teamName.split(/\s*\/\s*/).map(part => {
    const words = part.trim().split(/\s+/);
    return words.length > 1 ? words[words.length - 1] : words[0];
  }).join(" / ");
}

// ── Shared utility: "Aaron Jensen" → "A. Jensen" ──
//
// The compact form for anywhere a full name won't fit but a bare last
// name is ambiguous — two Jensens in a league is not hypothetical.
//
// This exact expression was already written out inline in
// IndividualLeaderboard and Admin; the fun-round tee sheet would have
// been a third copy. (Schedule has a deliberately DIFFERENT rule — it
// only adds the initial when two players share a last name — so it is
// not this function and shouldn't be folded into it.)
//
// A single-word name is returned unchanged: "Cher" has no last name to
// abbreviate toward, and "C. Cher" would be worse than useless.
export function initialLastName(fullName) {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}
