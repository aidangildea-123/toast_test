import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

export async function GET() {
  try {
    const host = process.env.TOAST_HOSTNAME!;
    const token = await getToastAccessToken();

    const res = await fetch(`https://${host}/restaurants/v1/restaurants`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "Restaurants request failed",
          status: res.status,
          detail: await res.text(),
        },
        { status: 500 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
