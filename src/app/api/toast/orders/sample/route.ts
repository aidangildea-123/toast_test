import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

export async function GET() {
  try {
    const host = process.env.TOAST_HOSTNAME!;
    const restaurantGuid = process.env.TOAST_RESTAURANT_GUID!;
    const token = await getToastAccessToken();

    if (!restaurantGuid) {
      return NextResponse.json({ error: "Missing TOAST_RESTAURANT_GUID" }, { status: 500 });
    }

    // Start simple: fetch a small batch for a single business date
    // (Toast will have specific query params for bulk orders — we’ll adjust once we see your docs)
    const businessDate = "20260110"; // Jan 10, 2026

    const res = await fetch(
      `https://${host}/orders/v2/orders?businessDate=${businessDate}&pageSize=10`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Toast-Restaurant-External-ID": restaurantGuid,
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: "Orders request failed", status: res.status, detail: await res.text() },
        { status: 500 }
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
