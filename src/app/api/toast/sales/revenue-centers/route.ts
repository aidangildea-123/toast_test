import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

export async function GET(req: Request) {
  try {
    const host = process.env.TOAST_HOSTNAME!;
    const token = await getToastAccessToken();

    // Read query params like ?start=20260101&end=20260107
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start"); // YYYYMMDD
    const end = searchParams.get("end");     // YYYYMMDD

    if (!start || !end) {
      return NextResponse.json(
        { error: "Missing required query params: start=YYYYMMDD&end=YYYYMMDD" },
        { status: 400 }
      );
    }

    // 1) Create an aggregated sales metrics request, grouped by revenue center
    const createRes = await fetch(`https://${host}/era/v1/metrics`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startBusinessDate: start,
        endBusinessDate: end,
        groupBy: ["REVENUE_CENTER"],
      }),
    });

    if (!createRes.ok) {
      return NextResponse.json(
        {
          error: "Failed to create Toast metrics report",
          status: createRes.status,
          detail: await createRes.text(),
        },
        { status: 500 }
      );
    }

    // Toast returns a GUID you use to fetch the results
    const reportRequestGuid = (await createRes.text()).replaceAll('"', "").trim();

    // 2) Retrieve the report results using the GUID
    const dataRes = await fetch(`https://${host}/era/v1/metrics/${reportRequestGuid}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!dataRes.ok) {
      return NextResponse.json(
        {
          error: "Failed to retrieve Toast metrics report",
          status: dataRes.status,
          detail: await dataRes.text(),
        },
        { status: 500 }
      );
    }

    const data = await dataRes.json();
    return NextResponse.json({ start, end, reportRequestGuid, data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
