import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { LicenseStatus } from "../types";

export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await invoke<LicenseStatus>("get_license_status");
      setStatus(s);
    } catch (e) {
      setError(String(e));
      setStatus({
        licensed: false,
        expiresAt: null,
        message: String(e),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    invoke<string>("get_machine_id")
      .then(setMachineId)
      .catch(() => setMachineId(null));
  }, [refresh]);

  const validate = useCallback(
    async (licenseKey: string) => {
      setError(null);
      setLoading(true);
      try {
        const s = await invoke<LicenseStatus>("validate_license", {
          licenseKey,
        });
        setStatus(s);
        return s;
      } catch (e) {
        const msg = String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    status,
    loading,
    machineId,
    error,
    refresh,
    validate,
  };
}
