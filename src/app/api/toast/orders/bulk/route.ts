// src/app/api/toast/orders/bulk/route.ts
import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

/**
 * Toast wants: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g. 2016-01-01T14:13:12.000+0400)
 *
 * Incoming query params often look like:
 * - 2026-01-09T00:00:00.000Z
 * - 2026-01-09T00:00:00.000+00:00
 * - 2026-01-09T00:00:00.000+0000
 *
 * Also: in query strings, "+" can get turned into a space.
 * This normalizer handles all of the above.
 */
function normalizeToastDate(input: string) {
  // Fix "+0000" becoming " 0000" after query parsing
  input = input.replace(/(\.\d{3}) (\d{4})$/, "$1+$2");

  // Convert ...Z => ...+0000
  if (input.endsWith("Z")) return input.replace(/Z$/, "+0000");

  // Convert ...+00:00 => ...+0000 (remove colon)
  input = input.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");

  return input;
}

/**
 * Pull only the metrics you care about per check:
 * - grossSales: sum of CAPTURED payment amounts on the check
 * - netSales: check.amount
 * - tax: check.taxAmount
 */
function extractCheckMetrics(data: any) {
  const orders = Array.isArray(data?.orderIds) ? data.orderIds : [];

  const checks = orders.flatMap((order: any) => {
    const orderChecks = Array.isArray(order?.checks) ? order.checks : [];
    return orderChecks.map((check: any) => {
      const payments = Array.isArray(check?.payments) ? check.payments : [];
      const capturedPayments = payments.filter(
        (p: any) => p?.paymentStatus === "CAPTURED"
      );

      const grossSales = capturedPayments.reduce((sum: number, p: any) => {
        const amt =
          typeof p?.amount === "number" ? p.amount : Number(p?.amount ?? 0);
        return sum + (Number.isFinite(amt) ? amt : 0);
      }, 0);

      const netSales =
        typeof check?.amount === "number"
          ? check.amount
          : Number(check?.amount ?? 0);

      const tax =
        typeof check?.taxAmount === "number"
          ? check.taxAmount
          : Number(check?.taxAmount ?? 0);

      return {
        orderGuid: order?.guid ?? null,
        orderDisplayNumber: order?.displayNumber ?? null,
        businessDate: order?.businessDate ?? null,
        paidDate: order?.paidDate ?? null,
        revenueCenterGuid: order?.revenueCenter?.guid ?? null,

        checkGuid: check?.guid ?? null,
        checkDisplayNumber: check?.displayNumber ?? null,
        tabName: check?.tabName ?? null,

        grossSales,
        netSales,
        tax,
      };
    });
  });

  return {
    startDate: data?.startDate ?? null,
    endDate: data?.endDate ?? null,
    page: data?.page ?? null,
    pageSize: data?.pageSize ?? null,
    checks,
  };
}

/**
 * GET /api/toast/orders/bulk
 *
 * Query params:
 *  - startDate (required) e.g. 2026-01-09T00:00:00.000Z
 *  - endDate   (required) e.g. 2026-01-11T00:00:00.000Z
 *  - page (optional, default 1)
 *  - pageSize (optional, default 10)
 *  - restaurantGuid (optional override; otherwise uses TOAST_RESTAURANT_GUID)
 *  - debug=1 (optional; returns raw Toast response metadata + payload)
 */
export async function GET(req: Request) {
  try {
    const host = process.env.TOAST_HOSTNAME;
    if (!host) {
      return NextResponse.json(
        { error: "Missing TOAST_HOSTNAME" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);

    // default from env, optional override via query param
    const restaurantGuid =
      url.searchParams.get("restaurantGuid") ??
      process.env.TOAST_RESTAURANT_GUID;

    const startDateRaw = url.searchParams.get("startDate");
    const endDateRaw = url.searchParams.get("endDate");
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "10");
    const debug = url.searchParams.get("debug") === "1";

    if (!restaurantGuid) {
      return NextResponse.json(
        {
          error:
            "Missing restaurant GUID (set TOAST_RESTAURANT_GUID or pass restaurantGuid=...)",
        },
        { status: 500 }
      );
    }

    if (!startDateRaw || !endDateRaw) {
      return NextResponse.json(
        { error: "Missing startDate or endDate query params" },
        { status: 400 }
      );
    }

    // ✅ Normalize into Toast's required format (handles Z, +00:00, +0000, and '+'->space)
    const startDate = normalizeToastDate(startDateRaw);
    const endDate = normalizeToastDate(endDateRaw);

    // Uses your existing working auth helper
    const token = await getToastAccessToken();

    // Toast docs: GET /orders/v2/ordersBulk with query params
    const toastUrl =
      `https://${host}/orders/v2/ordersBulk` +
      `?startDate=${encodeURIComponent(startDate)}` +
      `&endDate=${encodeURIComponent(endDate)}` +
      `&pageSize=${encodeURIComponent(String(pageSize))}` +
      `&page=${encodeURIComponent(String(page))}`;

    const toastRes = await fetch(toastUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Toast-Restaurant-External-ID": restaurantGuid,
      },
      cache: "no-store",
    });

    const rawText = await toastRes.text();

    // If Toast returns an empty body on success, fail loudly (otherwise you just get checks: [])
    if (toastRes.ok && (!rawText || rawText.trim() === "")) {
      return NextResponse.json(
        {
          error: "Toast returned an empty response body",
          status: toastRes.status,
          hint: "Often means no orders in the date range (or 204 No Content). Try a wider range.",
        },
        { status: 502 }
      );
    }

    // Parse JSON (or keep raw)
    let toastJson: any;
    try {
      toastJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      toastJson = { raw: rawText };
    }

    // Debug mode shows what Toast actually returned (super helpful for shaping)
    if (debug) {
      return NextResponse.json(
        {
          toastUrl,
          normalizedStartDate: startDate,
          normalizedEndDate: endDate,
          toastStatus: toastRes.status,
          toastOk: toastRes.ok,
          toastJsonType: Array.isArray(toastJson) ? "array" : typeof toastJson,
          toastJsonKeys:
            toastJson && typeof toastJson === "object"
              ? Object.keys(toastJson)
              : null,
          toastJson,
        },
        { status: 200 }
      );
    }

    if (!toastRes.ok) {
      return NextResponse.json(
        {
          error: "Toast ordersBulk failed",
          status: toastRes.status,
          detail: toastJson,
        },
        { status: toastRes.status }
      );
    }

    // ✅ Return ONLY the metrics you want
    const cleaned = extractCheckMetrics(toastJson);
    return NextResponse.json(cleaned, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
