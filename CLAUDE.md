# Working agreement

## Land it, don't ask

The default is to build the change and merge it. Aaron would rather look at the
result on his phone than read a description of it and approve a plan, and
`git revert` is cheap. A question that the merged result would have answered
faster than the question did is a question that should not have been asked.

So stop doing these:

- asking which of two layouts he prefers before building either one
- describing what a change will look like and waiting for a yes
- offering three options when one is clearly right and the other two exist for
  symmetry
- holding finished work back pending a question the merged result answers
- ending a message with "want me to go ahead?" when nothing is at risk

### The one exception

Land without asking **unless the change can fail in a way he cannot see.**
Then say so before merging — one or two sentences naming the specific failure,
not a general caveat. That covers:

- **Anything that can lie to the user.** A delete that reports success and
  leaves the record behind. A save that silently drops a field. These look
  correct on screen, which is exactly what makes them dangerous.
- **Writes to the live league during play.** Firestore is shared and live.
  There is no revert for a wrong score posted on a Monday night.
- **`firestore.rules` and Cloud Functions.** Reverting the commit does not
  un-lock-out a phone mid-round. Ordering still applies: app first, rules
  second.
- **Anything a `git revert` does not actually undo** — a Firestore data
  migration, a Firebase Console setting, a Vercel env var.
- **Work that is finished but inert until somebody deploys.** If a feature
  needs `firebase deploy --only functions` or a rules deploy to function, say
  so plainly at merge time. Otherwise it ships looking complete and fails in
  the field.

One flag, at the point of merging. If he says land it anyway, land it and don't
mention it again.

## Git

One task → one branch → one squashed commit on `main` → branch deleted. Branch
from an up-to-date `main`, keep the branch alive for hours not days, land it,
and let the merge remove it.

- **Never reuse a branch across sessions.** A `claude/*` branch is the
  workspace for one task.
- **Never merge `main` into a working branch.** Rebase:
  `git fetch origin && git rebase origin/main`.
- **Land through a PR** — `gh pr create --fill`, then
  `gh pr merge --squash --delete-branch`. A local merge skips the PR record
  *and* never triggers GitHub's *Automatically delete head branches*.
- **Never attempt to delete a remote branch yourself.** Some environments' git
  proxy refuses ref deletions. Let `gh pr merge --delete-branch` do it.

**Before starting new work**, run `git fetch --prune` and
`git branch -r --no-merged origin/main`. If anything comes back, name each
branch and summarise what it contains before touching anything else.

### Still expected on every commit

- Build before committing — `npm run build` must pass.
- `npm run test:run` must pass.
- Lint with `npx eslint <changed files>` and compare the error count against
  the same files before the change. **This repo carries ~102 pre-existing
  errors**; the bar is not adding new ones, not a clean sheet.

## Firestore is shared and live

One Firebase project (`mnq-golf-leage` — the typo is in the real project id)
holds the real league. Admin writes as you edit, so a dev server aimed at
production can corrupt a live week with one stray click.

- To aim a machine at a scratch project, copy `.env.example` to `.env.local`
  and set every `VITE_FIREBASE_*` var. **Partial overrides throw at startup on
  purpose** — a half-applied override would pair a scratch project id with the
  production API key, look like it worked, and write to production anyway.
  The decision lives in `src/lib/firebaseConfig.js`, is pure, and is tested.
- With no override, `src/firebase.js` logs a dev-mode warning naming the live
  project. If you see that warning, assume every write is real.
- A scratch project needs its own sign-in providers enabled and `localhost` in
  Authorized domains, or the dev server can read but nobody can log in.
- The service worker is a static file and cannot read env vars, so it keeps the
  production config inline and a scratch project gets no web push at all. That
  is the safe direction to fail.
- Never commit Firebase overrides or API secrets. `.env`, `*.local` and `*.p8`
  are gitignored.

## How the source is laid out

This shape is recent and deliberate. `src/theme.jsx` used to be 1,108 lines
holding design tokens, ten UI components **and** the entire league domain at
once; `lib/league.js` was the 861-line intermediate step. Both are gone.

- **`src/theme.js`** — design tokens only. Colours, type scale, weights,
  metrics, `getCSS`. **Imports nothing**, and that is the property to keep: the
  moment tokens import a component the cycle starts. No JSX, hence `.js`.
- **`src/components/icons.jsx`** — the icon set. `I.trophy(18, K.acc)` returns
  an `<svg>`; `EmptyState` looks icons up BY NAME off this object, so keep the
  shape.
- **`src/components/ui.jsx`** — shared chrome (`Card`, `Pill`, `EmptyState`,
  `LoadingPanel`, skeletons…). Reads tokens and icons, nothing else.
- **`src/components/`** — the rest of the shared components, including `Popup`.
- **`src/pages/`** — one file per screen. `Admin.jsx` is ~4,700 lines and is
  the file most likely to conflict.
- **`src/lib/`** — the domain, pure: no React, no Firestore, no DOM. Seven
  modules came out of `league.js`, and the graph is acyclic and shallow:

  | module | what it owns |
  |---|---|
  | `leagueConfig` | season dimensions; the customSeedWeeks (de)serialization |
  | `handicap` | what a player plays off, incl. going INTO week W |
  | `playerNames` | display formatting |
  | `matches` | who is in a match; whether its week is finished |
  | `individualRounds` | makeups, withdrawals, and the sentinel hole values |
  | `standings` | the table and the points that sort it |
  | `seeding` | seed maps, bracket order, current round, non-bracket pairing |

  Five of the seven import nothing. `standings` reaches `matchCalc`; `seeding`
  reaches `standings` and `matches`. Keep it that way.

**Tests live next to the code they cover.** Component tests use
`renderToStaticMarkup` from `react-dom/server` — no jsdom, no
testing-library, no extra dependency, and it reaches what those tests need,
which is structure.

### Things worth knowing before changing them

- **`buildStandingsForSeed` is the highest-leverage pure function here.** The
  Standings rank, the playoff seed map, the auto-seed pairings and bracket
  positioning all sit downstream. Its two calling modes and both tiebreaker
  chains are documented on the function itself.
- **A playoff week's `matches` array is TEE ORDER, not bracket order.** Reading
  one as the other puts the wrong teams on screen in the most visible week of
  the year. `orderByBracketIdx` exists for this.
- **Makeups, withdrawals and absences are sentinel hole VALUES, not flags.**
  `classifyScoreHole` is the only safe way to read one.
- **`matchPids` is the single source of truth for a match's roster.**
  Consolation matches can carry an explicit `players` array that ignores team
  lines, so deriving the roster from `team1`/`team2` is wrong for them.
- **Confirmations go through `useConfirm`**, which returns a promise:
  `if (await confirm({ title, message, destructive })) { … }`, with one
  `<ConfirmModal modal={confirmModal} />` rendered per component. Do not add a
  new piece of `confirmModal` state — there used to be seven of them.
- **`Popup`'s card is a FRAME; the scroller is inside it.** The close button is
  pinned to the frame. When the card was itself the scroller, the
  absolutely-positioned ✕ scrolled away with the content and a tall popup could
  not be closed at all. Don't collapse them back together.
- **`data-popup` on a modal's backdrop is load-bearing.**
  `usePullToRefresh` walks up from the touch target and bails when it crosses
  one. Any overlay that isn't a `<Popup>` has to carry the marker itself.

## Security rules

`firestore.rules` is the only thing between a stranger holding the app's public
config and the league's data. **`firestore.rules.test.mjs` covers it — 35
assertions. Run it before deploying a rules change:**

```
npm i --no-save firebase-tools @firebase/rules-unit-testing
npx firebase emulators:exec --only firestore --project mnq-rules-probe \
  "node firestore.rules.test.mjs"
```

Those two packages are deliberately **not** devDependencies — ~600 packages and
a JVM emulator between them. `--no-save` leaves `package.json` alone. The
vitest `include` is scoped to `src/` so this file never runs without an
emulator and turns `npm test` red on a clean checkout.

The access model, and the three things the tests exist to protect:

- **Reads are open to any signed-in user on purpose.** JoinScreen has to list
  players and read the invite code BEFORE the user has a member doc. So
  "signed in" is not "trusted", and every write path states its own gate.
- **Nobody promotes themselves.** `isCommissioner` lives on a member doc the
  member is allowed to write — exactly the shape that leaks a crown if the rule
  is careless. A commissioner updating their own row does keep the flag.
- **Fun rounds have a split write.** The commissioner owns the round; any
  member owns the tee sheet. It is the only field-level rule in the file
  (`hasOnly(['slots','guests'])`), and relaxing it to a plain `isMember()`
  write would let a member move a tee time booked with the pro shop while every
  screen still looked right.

Member doc ids are `league_2026_<uid>` and **must** match `LEAGUE_ID` in
`src/firebase.js`. The rules cannot express "first user bootstraps as
commissioner" (they cannot check that a collection is empty) — create the first
commissioner member doc from the Firebase console.

Deploy with `npm run rules`.

## Cloud Functions

`functions/index.js` — push notifications on league events (`onWeekLocked`,
`onMatchResultSigned`, `onWeekRainedOut`, `onAttendanceMarked`), plus
`sendTestPush` and `revokeUserSession`. They use the Admin SDK and bypass the
security rules entirely.

**They need `firebase deploy --only functions`.** Work that depends on a new or
changed function is inert until that runs — say so at merge time.

## The api/ handler during local dev

`api/calendar.js` is a Vercel serverless function and does not run under
`npm run dev`. Changing it needs `vercel dev`.

## The three golf apps

This is one of three — Bourbon Cup (`aarondjensen/bourbon-cup`), WBC
(`aarondjensen/WBC`) and this one. They share a real toolkit, and fixes have
historically travelled one way at a time, leaving each repo holding a repair
the other two never got.

Files that are shared and should stay in step: `lib/firebaseConfig.js`,
`lib/useConfirm.js`, `lib/useStableCallback.js`, `lib/useDirtyForm.js`,
`lib/usePullToRefresh.js`, `components/Popup.jsx` (same prop names in all
three: `noBackdropClose`, `noEscClose`, `outerPadding`, `innerStyle`,
`showClose`, `zIndex` as a number or `"content"`/`"modal"`), and the ESLint
environment blocks.

**If you fix one of these here, say so in the commit message** so it can be
carried across. `react/jsx-no-undef` is on in all three for the same reason: a
component used without its import lints clean, builds clean, and throws the
moment somebody opens that tab.
