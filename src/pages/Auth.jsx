import { useState, useMemo } from "react";
import { LEAGUE_ID } from "../firebase";
import { K } from "../theme";
import { parseScheduleDate } from "../lib/scheduleDate";

// NOTE: Font is loaded once via index.html's <link> + preconnect — the prior
// per-screen <link href={FONTS}> injections here were redundant duplicates and
// have been removed.

export function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 52 }}><img src="/MnQ_logo_transparent_bg.png" alt="MnQ Golf" style={{ width: 220, objectFit: "contain" }} /></div>
      <div className="pu" style={{ fontFamily: "'League Spartan', sans-serif", color: K.t3, fontSize: 13 }}>Loading...</div>
    </div>
  );
}


export function AuthScreen({ onGoogle, onEmail, onPasswordReset }) {
  // Mode state machine:
  //   main       — pick Google or Email
  //   email      — enter email + password to sign in (or auto-create account)
  //   reset      — enter email to request a reset link
  //   reset_sent — confirmation screen after the reset email was requested
  const [mode, setMode] = useState("main");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => { setBusy(true); setError(""); try { await onGoogle(); } catch (e) { setError(e.message || "Sign-in failed"); } setBusy(false); };
  const handleEmail = async () => {
    if (!email || !pw) { setError("Enter email and password"); return; }
    setBusy(true); setError("");
    try { await onEmail(email, pw); }
    catch (e) {
      // Map Firebase auth codes to human-readable messages. `auth/invalid-credential`
      // is the modern catch-all for wrong-password-or-unknown-email, but by the time
      // we get here App.jsx's doEmailSignIn has already distinguished the two — so
      // invalid-credential surfacing here means the create-account fallback itself
      // failed (weak password, etc.).
      const msg =
        e.code === "auth/wrong-password" ? "Wrong password" :
        e.code === "auth/invalid-email" ? "Invalid email" :
        e.code === "auth/weak-password" ? "Password must be at least 6 characters" :
        e.code === "auth/too-many-requests" ? "Too many attempts. Try again in a few minutes." :
        e.code === "auth/network-request-failed" ? "Network error. Check your connection." :
        e.message || "Sign-in failed";
      setError(msg);
    }
    setBusy(false);
  };
  const handleReset = async () => {
    if (!email) { setError("Enter your email"); return; }
    setBusy(true); setError("");
    try {
      await onPasswordReset(email);
      setMode("reset_sent");
    } catch (e) {
      const msg =
        e.code === "auth/invalid-email" ? "Invalid email" :
        e.code === "auth/missing-email" ? "Enter your email" :
        e.code === "auth/too-many-requests" ? "Too many attempts. Try again in a few minutes." :
        e.code === "auth/network-request-failed" ? "Network error. Check your connection." :
        e.message || "Could not send reset email";
      setError(msg);
    }
    setBusy(false);
  };

  // Press Enter to submit Email/Password sign-in. Avoids inline-onKeyDown
  // duplication across two inputs.
  const onEmailKey = (e) => { if (e.key === "Enter") handleEmail(); };

  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'League Spartan', sans-serif" }}>
      <div style={{ width: 340, textAlign: "center" }} className="fi">
        <img src="/MnQ_logo_transparent_bg.png" alt="Maize-N-Que Golf" style={{ width: 280, objectFit: "contain", marginBottom: 8 }} />
        <div style={{ color: K.t3, fontSize: 12, marginBottom: 32 }}>
          {mode === "reset" ? "Reset your password" :
           mode === "reset_sent" ? "Check your email" :
           "Sign in to continue"}
        </div>

        {mode === "main" && (<>
          <button onClick={handleGoogle} disabled={busy} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, cursor: "pointer", fontSize: 15, fontWeight: 600, background: "#fff", color: "#333", border: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10, opacity: busy ? .6 : 1 }}>
            <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#34A853" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}><div style={{ flex: 1, height: 1, background: K.bdr }} /><span style={{ fontSize: 11, color: K.t3 }}>or</span><div style={{ flex: 1, height: 1, background: K.bdr }} /></div>
          <button onClick={() => setMode("email")} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, cursor: "pointer", fontSize: 14, fontWeight: 600, background: K.card, color: K.t1, border: `1px solid ${K.bdr}` }}>Sign in with Email</button>
        </>)}

        {mode === "email" && (<>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" onKeyDown={onEmailKey} style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 15, marginBottom: 8, textAlign: "center" }} />
          <input value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" onKeyDown={onEmailKey} style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 15, marginBottom: 12, textAlign: "center" }} />
          <button onClick={handleEmail} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10, opacity: busy ? .6 : 1 }}>Sign In / Create Account</button>
          {/* Forgot password — jumps to reset mode, keeping the typed email so the
              user doesn't have to retype it. Plain text link is intentionally
              understated since it's not the primary action. */}
          <button onClick={() => { setMode("reset"); setError(""); }} style={{ background: "none", border: "none", color: K.acc, fontSize: 12, cursor: "pointer", marginBottom: 10, textDecoration: "underline" }}>Forgot password?</button>
          <button onClick={() => { setMode("main"); setError(""); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", display: "block", margin: "0 auto" }}>← Back to options</button>
        </>)}

        {mode === "reset" && (<>
          <div style={{ color: K.t2, fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
            Enter the email you use to sign in. We'll send a link to reset your password.
          </div>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" onKeyDown={e => e.key === "Enter" && handleReset()} style={{ width: "100%", padding: "13px 16px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 15, marginBottom: 12, textAlign: "center" }} />
          <button onClick={handleReset} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10, opacity: busy ? .6 : 1 }}>Send Reset Link</button>
          <button onClick={() => { setMode("email"); setError(""); }} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer" }}>← Back to sign in</button>
        </>)}

        {mode === "reset_sent" && (<>
          <div style={{ color: K.t1, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            Reset link sent
          </div>
          <div style={{ color: K.t2, fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>
            If an account exists for <span style={{ color: K.t1, fontWeight: 600 }}>{email}</span>, you'll receive an email with a link to reset your password.
          </div>
          <div style={{ color: K.t3, fontSize: 11, marginBottom: 20, lineHeight: 1.5 }}>
            Check your spam folder if it doesn't arrive in a few minutes.
          </div>
          <button onClick={() => { setMode("email"); setPw(""); setError(""); }} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>Back to Sign In</button>
        </>)}

        {error && <div style={{ color: K.red, fontSize: 12, marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  );
}


export function JoinScreen({ authUser, members, players, saveMember, doSignOut, leagueConfig, schedule }) {
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const isFirstUser = members.length === 0;
  const existingMember = members.find(m => m.uid === authUser.uid);
  const assigned = members.map(m => m.playerId).filter(Boolean);
  const needsLink = existingMember && !existingMember.playerId && players.length > 0;
  const storedCode = leagueConfig?.inviteCode || "";

  // ── Next-match display (1.10E) ───────────────────────────────────
  // Surface the league's cadence on the join screen so a returning
  // member who just signed in sees at a glance "ok, next match is
  // Tuesday at 4:28 PM" without having to complete the join flow
  // first. Falls back to nothing if schedule hasn't loaded yet or
  // there's no playable upcoming week — graceful, never a blank
  // "next match: —" row that draws the eye to nothing.
  const nextMatch = useMemo(() => {
    if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return null;
    const now = new Date();
    const year = leagueConfig?.year || now.getFullYear();
    // Walk in week order; the first non-rained-out non-locked week
    // with matches IS the next one. Same heuristic the rest of the
    // app uses for "current/next playable" via currentWeek.
    for (const wk of schedule) {
      if (wk.rainedOut || wk.locked) continue;
      if (!wk.matches || wk.matches.length === 0) continue;
      // Date may be unparseable for older test data — skip silently
      // rather than throwing.
      const wkDate = wk.date ? parseScheduleDate(wk.date, year) : null;
      if (!wkDate) continue;
      // Only show future dates; today's match is still "next" until
      // play actually concludes.
      if (wkDate.getTime() < now.setHours(0, 0, 0, 0)) continue;
      const dayLabel = wkDate.toLocaleDateString("en-US", {
        weekday: "long", month: "short", day: "numeric",
      });
      const startTime = leagueConfig?.startTime || "4:28 PM";
      return { dayLabel, startTime, week: wk.week };
    }
    return null;
  }, [schedule, leagueConfig]);

  const handleJoin = async (asCommissioner = false) => {
    // Check invite code (skip for first user/commissioner setup, or if already a member needing to link)
    if (!isFirstUser && !existingMember && storedCode) {
      if (inviteCode.toUpperCase().trim() !== storedCode.toUpperCase().trim()) {
        setCodeError(true);
        return;
      }
    }
    setBusy(true);
    await saveMember({ id: existingMember?.id || `${LEAGUE_ID}_${authUser.uid}`, uid: authUser.uid, email: authUser.email, name: authUser.displayName || authUser.email?.split("@")[0] || "Player", playerId: selectedPlayer || null, isCommissioner: asCommissioner || existingMember?.isCommissioner || false });
    setBusy(false);
  };

  const title = needsLink ? "Link Your Profile" : isFirstUser ? "Welcome!" : "Join League";
  const subtitle = needsLink
    ? "Select your player profile to get started:"
    : isFirstUser
    ? "You're the first one here! Set yourself up as commissioner to get started."
    : players.length > 0
    ? "Select your player profile to join:"
    : "No player profiles yet — your commissioner is still setting up.";

  // Check if invite code is required (not first user, not already a member)
  const needsCode = !isFirstUser && !existingMember && storedCode;

  return (
    <div style={{ minHeight: "100vh", background: K.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'League Spartan', sans-serif" }}>
      <div style={{ width: 340, textAlign: "center" }} className="fi">
        <img src="/MnQ_logo_transparent_bg.png" alt="Maize-N-Que Golf" style={{ width: 240, objectFit: "contain", marginBottom: 8 }} />
        <div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, color: K.acc, letterSpacing: 1, marginBottom: 4 }}>{title}</div>
        <div style={{ color: K.t3, fontSize: 12, marginBottom: 6 }}>Signed in as <span style={{ color: K.t2, fontWeight: 600 }}>{authUser.email}</span></div>
        <div style={{ color: K.t2, fontSize: 13, marginBottom: 16, lineHeight: 1.5, padding: "0 12px" }}>{subtitle}</div>

        {/* Next-match strip — shown only when we have schedule data and
            an upcoming playable week. Sits above the join action so the
            league's cadence is visible before any tap. */}
        {nextMatch && (
          <div style={{
            background: K.card, border: `1px solid ${K.matchGrn}40`,
            borderRadius: 10, padding: "10px 12px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              fontSize: 9, fontWeight: 800, color: K.matchGrn,
              letterSpacing: 1, textTransform: "uppercase", flexShrink: 0,
            }}>Next Match</div>
            <div style={{ flex: 1, textAlign: "right", lineHeight: 1.2 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: K.t1 }}>{nextMatch.dayLabel}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: K.t2 }}>{nextMatch.startTime} · Week {nextMatch.week}</div>
            </div>
          </div>
        )}

        {isFirstUser ? (
          <button onClick={() => handleJoin(true)} disabled={busy} style={{ width: "100%", padding: "14px", borderRadius: 12, background: K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? .6 : 1 }}>Create League as Commissioner</button>
        ) : (<>
          {needsCode && (
            <div style={{ marginBottom: 12 }}>
              <input
                value={inviteCode}
                onChange={e => { setInviteCode(e.target.value); setCodeError(false); }}
                placeholder="Enter invite code"
                style={{ width: "100%", padding: "12px", borderRadius: 10, background: K.inp, border: `1px solid ${codeError ? '#f87171' : K.bdr}`, color: K.t1, fontSize: 14, textAlign: "center", letterSpacing: 2, textTransform: "uppercase" }}
              />
              {codeError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>Invalid invite code</div>}
            </div>
          )}
          {players.length > 0 && (
            <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={{ width: "100%", padding: "12px", borderRadius: 10, background: K.inp, border: `1px solid ${K.bdr}`, color: K.t1, fontSize: 14, marginBottom: 12, textAlign: "center" }}>
              <option value="">— Select your name —</option>
              {players.filter(p => !assigned.includes(p.id) || (existingMember && p.id === existingMember.playerId)).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => handleJoin(false)} disabled={busy || (players.length > 0 && !selectedPlayer)} style={{ width: "100%", padding: "14px", borderRadius: 12, background: (players.length > 0 && !selectedPlayer) ? K.t3 : K.act, border: "none", color: K.bg, fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: busy ? .6 : 1 }}>
            {needsLink ? "Link Profile" : "Join League"}
          </button>
        </>)}
        <button onClick={doSignOut} style={{ background: "none", border: "none", color: K.t3, fontSize: 12, cursor: "pointer", marginTop: 12 }}>Sign out</button>
      </div>
    </div>
  );
}
