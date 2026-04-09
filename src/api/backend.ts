const base = () => import.meta.env.VITE_API_URL || "";

const TOKEN_KEY = "ytdl_auth_token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): HeadersInit {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export type User = {
  id: string;
  email: string;
  name: string;
  publishingCredits: number;
  creditsRemaining: number;
  createdAt?: string;
};

export type TokenPack = {
  id: string;
  credits: number;
  amountUsd: number;
  label: string;
  description: string;
  popular?: boolean;
};

export async function loginWithEmail(email: string, password: string) {
  const res = await fetch(`${base()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = (await parseJson(res)) as {
    token?: string;
    user?: User;
    message?: string;
    field?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(data?.message || "Login failed"), {
      field: data?.field,
    });
  return data as { token: string; user: User };
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string,
) {
  const res = await fetch(`${base()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const data = (await parseJson(res)) as {
    token?: string;
    user?: User;
    message?: string;
    field?: string;
  };
  if (!res.ok)
    throw Object.assign(new Error(data?.message || "Registration failed"), {
      field: data?.field,
    });
  return data as { token: string; user: User };
}

export async function getMe(): Promise<User> {
  const res = await fetch(`${base()}/api/auth/me`, {
    headers: { ...authHeaders() },
  });
  const data = (await parseJson(res)) as { message?: string } & Partial<User>;
  if (!res.ok) throw new Error(data?.message || "Not authenticated");
  return data as User;
}

export async function getPaypalClientId(): Promise<string> {
  const res = await fetch(`${base()}/api/paypal/client-id`);
  const data = (await parseJson(res)) as { clientId?: string };
  return data?.clientId || "";
}

export async function getTokenPacks(): Promise<TokenPack[]> {
  const res = await fetch(`${base()}/api/payments/token-packs`);
  const data = (await parseJson(res)) as { packs?: TokenPack[]; message?: string };
  if (!res.ok) throw new Error(data?.message || "Failed to load packs");
  return data?.packs || [];
}

export async function getRazorpayKeyId(): Promise<string> {
  const res = await fetch(`${base()}/api/payments/razorpay/key-id`);
  const data = (await parseJson(res)) as { keyId?: string };
  return data?.keyId || "";
}

export async function createRazorpayOrder(productType: string) {
  const res = await fetch(`${base()}/api/payments/razorpay/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ productType }),
  });
  const data = (await parseJson(res)) as Record<string, unknown>;
  if (!res.ok) throw new Error((data?.message as string) || "Razorpay order failed");
  return data as {
    orderId: string;
    paymentId: string;
    amountPaise: number;
    currency: string;
    pack: { label: string; credits: number; amountUsd: number };
  };
}

export async function verifyRazorpayPayment(payload: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  paymentId: string;
}) {
  const res = await fetch(`${base()}/api/payments/razorpay/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  const data = (await parseJson(res)) as { message?: string };
  if (!res.ok) throw new Error(data?.message || "Verification failed");
  return data as { user: User };
}

export async function createPaypalOrder(productType: string) {
  const res = await fetch(`${base()}/api/payments/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ productType }),
  });
  const data = (await parseJson(res)) as Record<string, unknown>;
  if (!res.ok) throw new Error((data?.message as string) || "PayPal order failed");
  return data as {
    orderId: string;
    paymentId: string;
    amountUsd: number;
    publishingCreditsGranted: number;
  };
}

export async function capturePaypalOrder(orderId: string) {
  const res = await fetch(`${base()}/api/payments/capture-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ orderId }),
  });
  const data = (await parseJson(res)) as { message?: string; user?: User };
  if (!res.ok) throw new Error(data?.message || "Capture failed");
  return data as { user: User };
}
