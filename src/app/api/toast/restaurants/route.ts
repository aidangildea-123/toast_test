import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

export async function GET() {
  try {
    const host = process.env.TOAST_HOSTNAME!;
    const token = await getToastAccessToken();

    // TODO: Replace this path with the specific endpoint you have access to.
    // Toast has multiple API families; the "right" restaurants/locations endpoint depends on your program/scopes.
    const res = await fetch(`https://${host}/YOUR_RESTAURANTS_ENDPOINT_HERE`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Toast API call failed", status: res.status, detail: await res.text() },
        { status: 500 }
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
