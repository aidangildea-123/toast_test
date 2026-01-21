import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    restaurantGuid: process.env.TOAST_RESTAURANT_GUID ?? null,
  });
}
