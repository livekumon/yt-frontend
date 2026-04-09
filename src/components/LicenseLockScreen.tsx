import { FormEvent, useState } from "react";
import type { LicenseStatus } from "../types";

type Props = {
  machineId: string | null;
  loading: boolean;
  error: string | null;
  onValidate: (key: string) => Promise<LicenseStatus>;
};

export function LicenseLockScreen({
  machineId,
  loading,
  error,
  onValidate,
}: Props) {
  const [key, setKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const trimmed = key.trim();
    if (!trimmed) {
      setLocalError("Enter your license key.");
      return;
    }
    try {
      await onValidate(trimmed);
    } catch {
      /* parent sets error */
    }
  }

  return (
    <div className="lock-screen">
      <div className="lock-card">
        <h1 className="lock-title">YouTube Downloader</h1>
        <p className="lock-sub">
          Enter a valid license key. Your machine ID is sent to the activation
          server for validation.
        </p>
        {machineId ? (
          <div className="machine-id">
            <span className="machine-id-label">Machine ID</span>
            <code className="machine-id-value">{machineId}</code>
          </div>
        ) : null}
        <form className="lock-form" onSubmit={onSubmit}>
          <input
            type="password"
            autoComplete="off"
            placeholder="License key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Checking…" : "Unlock"}
          </button>
        </form>
        {(error || localError) && (
          <p className="lock-error" role="alert">
            {error ?? localError}
          </p>
        )}
      </div>
    </div>
  );
}
