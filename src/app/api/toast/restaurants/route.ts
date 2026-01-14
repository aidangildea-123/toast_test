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

    // Restaurants API: get restaurant by GUID
    const res = await fetch(`https://${host}/restaurants/v1/restaurants/${restaurantGuid}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": restaurantGuid,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Restaurant lookup failed", status: res.status, detail: await res.text() },
        { status: 500 }
      );
    }

    return NextResponse.json(await res.json());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown server error" }, { status: 500 });
  }
}
