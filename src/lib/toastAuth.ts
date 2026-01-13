type ToastTokenResponse = {
    token?: {
      accessToken?: string;
      expiresIn?: number;
      tokenType?: string;
    };
  };
  
  export async function getToastAccessToken(): Promise<string> {
    const host = process.env.TOAST_HOSTNAME;
    const clientId = process.env.TOAST_CLIENT_ID;
    const clientSecret = process.env.TOAST_CLIENT_SECRET;
  
    if (!host || !clientId || !clientSecret) {
      throw new Error("Missing TOAST_* env vars");
    }
  
    const res = await fetch(`https://${host}/authentication/v1/authentication/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        userAccessType: "TOAST_MACHINE_CLIENT",
      }),
    });
  
    if (!res.ok) throw new Error(`Toast auth failed: ${res.status} ${await res.text()}`);
  
    const data = (await res.json()) as ToastTokenResponse;
    const accessToken = data.token?.accessToken;
  
    if (!accessToken) throw new Error("Toast auth response missing accessToken");
  
    return accessToken;
  }
  