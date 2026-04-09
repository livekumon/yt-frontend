import { FormEvent, useState } from "react";
import { loginWithEmail, registerWithEmail } from "../api/backend";
import { useAuth } from "../context/AuthContext";

export function LoginModule() {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        const { token, user } = await registerWithEmail(
          name.trim(),
          email.trim(),
          password,
        );
        login(token, user);
      } else {
        const { token, user } = await loginWithEmail(email.trim(), password);
        login(token, user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card" style={{ maxWidth: 440 }}>
        <h1 className="lock-title">YouTube Downloader</h1>
        <p className="lock-sub">
          {mode === "login"
            ? "Sign in to continue. Purchase download credits after you sign in."
            : "Create an account. You can buy credits on the next step."}
        </p>
        <div className="auth-mode-toggle">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            Register
          </button>
        </div>
        <form className="lock-form" onSubmit={onSubmit}>
          {mode === "register" ? (
            <input
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
            />
          ) : null}
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            placeholder="Password (8+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
            minLength={8}
          />
          <button type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        {error ? (
          <p className="lock-error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="api-hint">
          Set <code>VITE_API_URL</code> to your deployed API (e.g. Vercel).
        </p>
      </div>
    </div>
  );
}
