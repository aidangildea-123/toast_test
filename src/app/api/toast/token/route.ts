import { NextResponse } from "next/server";

export async function GET() {
  const host = process.env.TOAST_HOSTNAME;
  const clientId = process.env.TOAST_CLIENT_ID;
  const clientSecret = process.env.TOAST_CLIENT_SECRET;

  if (!host || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing TOAST_HOSTNAME / TOAST_CLIENT_ID / TOAST_CLIENT_SECRET" },
      { status: 500 }
    );
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

  if (!res.ok) {
    return NextResponse.json(
      { error: "Toast authentication failed", status: res.status, detail: await res.text() },
      { status: 500 }
    );
  }

  const data = await res.json();

  // Debug-only: don't return the actual token contents long-term.
  return NextResponse.json({ ok: true });
}
