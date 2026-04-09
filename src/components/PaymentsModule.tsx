import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  capturePaypalOrder,
  createPaypalOrder,
  createRazorpayOrder,
  getPaypalClientId,
  getRazorpayKeyId,
  getTokenPacks,
  verifyRazorpayPayment,
  type TokenPack,
} from "../api/backend";
import { useAuth } from "../context/AuthContext";

function detectIsIndia() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz === "Asia/Calcutta" || tz === "Asia/Kolkata";
  } catch {
    return false;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const GATEWAY_PAYPAL = "paypal";
const GATEWAY_RAZORPAY = "razorpay";

type Props = {
  onPurchased: () => void;
};

export function PaymentsModule({ onPurchased }: Props) {
  const { user, refreshUser } = useAuth();
  const isIndia = detectIsIndia();
  const [paypalClientId, setPaypalClientId] = useState("");
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
  const [packs, setPacks] = useState<TokenPack[]>([]);
  const [selectedPack, setSelectedPack] = useState<TokenPack | null>(null);
  const [loadingPacks, setLoadingPacks] = useState(true);
  const [gateway, setGateway] = useState(
    isIndia ? GATEWAY_RAZORPAY : GATEWAY_PAYPAL,
  );
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const [payMessage, setPayMessage] = useState("");
  const rzpRef = useRef<{ open: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [pp, rzp, list] = await Promise.all([
          getPaypalClientId(),
          getRazorpayKeyId(),
          getTokenPacks(),
        ]);
        if (cancelled) return;
        setPaypalClientId(pp);
        setRazorpayKeyId(rzp);
        setPacks(list);
        setSelectedPack(list.find((p) => p.popular) || list[0] || null);
      } catch {
        if (!cancelled) setPacks([]);
      } finally {
        if (!cancelled) setLoadingPacks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePaypalCreate = useCallback(async () => {
    if (!selectedPack) throw new Error("No pack selected");
    setPayStatus("processing");
    setPayMessage("");
    const data = await createPaypalOrder(selectedPack.id);
    return data.orderId;
  }, [selectedPack]);

  const handlePaypalApprove = useCallback(
    async (data: { orderID?: string }) => {
      const orderID = data.orderID;
      if (!orderID) return;
      try {
        await capturePaypalOrder(orderID);
        await refreshUser();
        setPayStatus("success");
        setPayMessage("Payment successful.");
        onPurchased();
      } catch (err) {
        setPayStatus("error");
        setPayMessage(err instanceof Error ? err.message : "Capture failed.");
      }
    },
    [refreshUser, onPurchased],
  );

  const handlePaypalError = useCallback(() => {
    setPayStatus("error");
    setPayMessage("Something went wrong with PayPal.");
  }, []);

  const handlePaypalCancel = useCallback(() => {
    setPayStatus(null);
    setPayMessage("");
  }, []);

  const handleRazorpay = useCallback(async () => {
    if (!selectedPack) return;
    setPayStatus("processing");
    setPayMessage("");
    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error("Failed to load Razorpay checkout.");
      const order = await createRazorpayOrder(selectedPack.id);
      await new Promise<void>((resolve, reject) => {
        const inst = new window.Razorpay({
          key: razorpayKeyId,
          amount: order.amountPaise,
          currency: "INR",
          name: "YouTube Downloader",
          description: `${selectedPack.label} — ${selectedPack.credits} download credit${selectedPack.credits !== 1 ? "s" : ""}`,
          order_id: order.orderId,
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              await verifyRazorpayPayment({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                paymentId: order.paymentId,
              });
              await refreshUser();
              setPayStatus("success");
              setPayMessage("Payment successful.");
              onPurchased();
              resolve();
            } catch (err) {
              setPayStatus("error");
              setPayMessage(
                err instanceof Error ? err.message : "Verification failed.",
              );
              reject(err);
            }
          },
          modal: {
            ondismiss: () => {
              setPayStatus(null);
              setPayMessage("");
              resolve();
            },
          },
          prefill: { email: user?.email || "", name: user?.name || "" },
          theme: { color: "#1f6feb" },
        });
        rzpRef.current = inst;
        inst.open();
      });
    } catch (err) {
      setPayStatus("error");
      setPayMessage(err instanceof Error ? err.message : "Payment failed.");
    }
  }, [selectedPack, razorpayKeyId, user, refreshUser, onPurchased]);

  if (loadingPacks) {
    return (
      <div className="app-shell">
        <p className="loading-msg">Loading payment options…</p>
      </div>
    );
  }

  return (
    <div className="app-shell payments-shell">
      <h1 className="downloader-title">Buy download credits</h1>
      <p className="payments-intro">
        Choose a pack, then pay with{" "}
        <strong>PayPal (USD, worldwide)</strong> or{" "}
        <strong>Razorpay (INR, India)</strong> — same model as Place to Page.
      </p>

      <div className="panel-section">
        <label className="field-label">Pack</label>
        <select
          className="format-select"
          value={selectedPack?.id ?? ""}
          onChange={(e) => {
            const p = packs.find((x) => x.id === e.target.value);
            setSelectedPack(p || null);
          }}
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.credits} credit{p.credits !== 1 ? "s" : ""} — $
              {p.amountUsd}
            </option>
          ))}
        </select>
      </div>

      {selectedPack ? (
        <div className="checkout-panel">
          <div className="pack-summary">
            <span>
              {selectedPack.credits} credit{selectedPack.credits !== 1 ? "s" : ""}
            </span>
            <span className="pack-price">${selectedPack.amountUsd} USD</span>
            <span className="pack-badge">{selectedPack.label}</span>
          </div>

          <div className="gateway-grid">
            <button
              type="button"
              className={`gateway-btn ${gateway === GATEWAY_PAYPAL ? "active" : ""}`}
              onClick={() => {
                setGateway(GATEWAY_PAYPAL);
                setPayStatus(null);
                setPayMessage("");
              }}
            >
              <span className="gateway-title">PayPal</span>
              <span className="gateway-sub">USD · Worldwide</span>
            </button>
            <button
              type="button"
              className={`gateway-btn ${gateway === GATEWAY_RAZORPAY ? "active" : ""}`}
              onClick={() => {
                setGateway(GATEWAY_RAZORPAY);
                setPayStatus(null);
                setPayMessage("");
              }}
            >
              <span className="gateway-title">Razorpay</span>
              <span className="gateway-sub">INR · India</span>
            </button>
          </div>

          {payStatus === "error" && (
            <div className="pay-error" role="alert">
              {payMessage}
            </div>
          )}
          {payStatus === "success" && (
            <div className="pay-success" role="status">
              {payMessage}
            </div>
          )}

          {gateway === GATEWAY_PAYPAL &&
            (!paypalClientId ? (
              <p className="pay-warn">
                PayPal is not configured on the server (set PAYPAL_CLIENT_ID /
                SECRET).
              </p>
            ) : (
              <PayPalScriptProvider
                key={paypalClientId}
                options={{
                  clientId: paypalClientId,
                  currency: "USD",
                  intent: "capture",
                }}
              >
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", label: "pay" }}
                  disabled={payStatus === "processing"}
                  createOrder={handlePaypalCreate}
                  onApprove={handlePaypalApprove}
                  onError={handlePaypalError}
                  onCancel={handlePaypalCancel}
                />
              </PayPalScriptProvider>
            ))}

          {gateway === GATEWAY_RAZORPAY &&
            (!razorpayKeyId ? (
              <p className="pay-warn">
                Razorpay is not configured (set RAZORPAY_KEY_ID / SECRET).
              </p>
            ) : (
              <div className="rzp-block">
                <p className="rzp-approx">
                  Approx.{" "}
                  <strong>
                    ₹{Math.round(selectedPack.amountUsd * 84)}
                  </strong>{" "}
                  (rate from server)
                </p>
                <button
                  type="button"
                  className="rzp-pay-btn"
                  disabled={payStatus === "processing"}
                  onClick={() => void handleRazorpay()}
                >
                  {payStatus === "processing"
                    ? "Processing…"
                    : "Pay with Razorpay"}
                </button>
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

