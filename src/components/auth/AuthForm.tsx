"use client";

import { useState, type FormEvent } from "react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import styles from "./AuthForm.module.css";

interface AuthFormProps {
  mode: "login" | "signup";
}

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Incorrect email or password.",
  AccessDenied: "This app is invite-only right now — ask the owner to add your email.",
  OAuthAccountNotLinked: "That email is already registered a different way — sign in with your password instead."
};

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? "Something went wrong signing in.";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/campaigns";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(friendlyError(searchParams.get("error")));
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    if (mode === "signup") {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined, email, password })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Sign up failed.");
        setBusy(false);
        return;
      }
    }

    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError(friendlyError(result.error) ?? "Incorrect email or password.");
      setBusy(false);
      return;
    }
    router.push(callbackUrl as Route);
    router.refresh();
  }

  return (
    <div className={styles.card}>
      <h1>{mode === "signup" ? "Create an account" : "Sign in"}</h1>

      <button
        type="button"
        className={styles.google}
        onClick={() => void signIn("google", { redirectTo: callbackUrl })}
      >
        Continue with Google
      </button>

      <div className={styles.divider}>
        <span>or</span>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        {mode === "signup" ? (
          <label className={styles.field}>
            Name
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </label>
        ) : null}
        <label className={styles.field}>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className={styles.field}>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>

        {error ? <p className={styles.error}>{error}</p> : null}

        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className={styles.switch}>
        {mode === "signup" ? (
          <>
            Already have an account? <a href="/login">Sign in</a>
          </>
        ) : (
          <>
            Need an account? <a href="/signup">Sign up</a>
          </>
        )}
      </p>
    </div>
  );
}
