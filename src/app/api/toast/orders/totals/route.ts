// src/app/api/toast/orders/totals/route.ts
import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

function normalizeToastDate(input: string) {
  // If "+" came through as a space in timezone, fix it
  input = input.replace(/(\.\d{3}) (\d{4})$/, "$1+$2");

  // Convert ...Z => ...+0000
  if (input.endsWith("Z")) return input.replace(/Z$/, "+0000");

  // Convert ...+00:00 => ...+0000 (remove colon)
  return input.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");
}

/**
 * Toast "ordersBulk" responses vary depending on config.
 * We try to find an array of "order-like" objects anywhere.
 */
function extractOrders(toastJson: any): any[] {
  if (!toastJson) return [];

  // Common patterns:
  // 1) { orders: [...] }
  if (Array.isArray(toastJson.orders)) return toastJson.orders;

  // 2) { orderIds: [...] } BUT sometimes this is actually full order objects
  if (Array.isArray(toastJson.orderIds)) return toastJson.orderIds;

  // 3) response itself is an array (either orders or IDs)
  if (Array.isArray(toastJson)) return toastJson;

  // 4) nested containers (rare, but handle gently)
  if (toastJson.data && Array.isArray(toastJson.data.orders)) return toastJson.data.orders;

  return [];
}

/**
 * Sums totals across whatever order/check/payment objects exist.
 *
 * Definitions (based on your sample):
 * - grossSales: sum of CAPTURED payment.amount on each check
 * - netSales: sum of check.amount
 * - tax: sum of check.taxAmount
 */
function sumTotalsFromOrders(orders: any[]) {
  let totalGrossSales = 0;
  let totalNetSales = 0;
  let totalTax = 0;

  let orderCount = 0;
  let checkCount = 0;
  let capturedPaymentCount = 0;

  for (const order of orders) {
    // If "orders" are actually IDs (strings), we can't sum without a second call.
    // We'll just skip non-objects.
    if (!order || typeof order !== "object") continue;

    orderCount += 1;

    const checks = Array.isArray(order.checks) ? order.checks : [];
    for (const check of checks) {
      if (!check || typeof check !== "object") continue;
      checkCount += 1;

      const net = typeof check.amount === "number" ? check.amount : Number(check.amount ?? 0);
      if (Number.isFinite(net)) totalNetSales += net;

      const tax = typeof check.taxAmount === "number" ? check.taxAmount : Number(check.taxAmount ?? 0);
      if (Number.isFinite(tax)) totalTax += tax;

      const payments = Array.isArray(check.payments) ? check.payments : [];
      for (const p of payments) {
        if (!p || typeof p !== "object") continue;
        if (p.paymentStatus === "CAPTURED") {
          capturedPaymentCount += 1;
          const amt = typeof p.amount === "number" ? p.amount : Number(p.amount ?? 0);
          if (Number.isFinite(amt)) totalGrossSales += amt;
        }
      }
    }
  }

  return {
    totalGrossSales,
    totalNetSales,
    totalTax,
    orderCount,
    checkCount,
    capturedPaymentCount,
  };
}

/**
 * GET /api/toast/orders/totals?startDate=...&endDate=...&pageSize=...&page=...
 *
 * You can pass Z-format in the browser like:
 * startDate=2026-01-09T00:00:00.000Z&endDate=2026-01-10T00:00:00.000Z
 * We normalize to Toast’s required +0000 format internally.
 */
export async function GET(req: Request) {
  try {
    const host = process.env.TOAST_HOSTNAME;
    if (!host) {
      return NextResponse.json({ error: "Missing TOAST_HOSTNAME" }, { status: 500 });
    }

    const url = new URL(req.url);

    const restaurantGuid =
      url.searchParams.get("restaurantGuid") ?? process.env.TOAST_RESTAURANT_GUID;

    const startDateRaw = url.searchParams.get("startDate");
    const endDateRaw = url.searchParams.get("endDate");

    // For totals you usually want a big pageSize (Toast may cap it; start with 100)
    const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
    const page = Number(url.searchParams.get("page") ?? "1");

    const debug = url.searchParams.get("debug") === "1";

    if (!restaurantGuid) {
      return NextResponse.json(
        { error: "Missing TOAST_RESTAURANT_GUID (or pass restaurantGuid=...)" },
        { status: 500 }
      );
    }

    if (!startDateRaw || !endDateRaw) {
      return NextResponse.json(
        { error: "Missing startDate or endDate query params" },
        { status: 400 }
      );
    }

    const startDate = normalizeToastDate(startDateRaw);
    const endDate = normalizeToastDate(endDateRaw);

    const token = await getToastAccessToken();

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

    let toastJson: any;
    try {
      toastJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      toastJson = { raw: rawText };
    }

    if (!toastRes.ok) {
      return NextResponse.json(
        {
          error: "Toast ordersBulk failed",
          status: toastRes.status,
          detail: toastJson,
          hint:
            "If this is a date-format error, use Z format in the browser and let the server normalize it.",
        },
        { status: toastRes.status }
      );
    }

    const orders = extractOrders(toastJson);

    // If it’s IDs-only, we can’t sum without a second endpoint call per ID.
    const containsOnlyIds =
      orders.length > 0 && orders.every((x) => typeof x === "string");

    if (containsOnlyIds) {
      return NextResponse.json(
        {
          error: "ordersBulk returned only order IDs (no order details to sum).",
          orderIdCount: orders.length,
          nextStep:
            "We need to call the order-details endpoint for a batch of IDs (or use a bulk-details endpoint if available).",
          sampleIds: orders.slice(0, 10),
          normalizedStartDate: startDate,
          normalizedEndDate: endDate,
        },
        { status: 200 }
      );
    }

    const totals = sumTotalsFromOrders(orders);

    if (debug) {
      return NextResponse.json(
        {
          normalizedStartDate: startDate,
          normalizedEndDate: endDate,
          toastUrl,
          toastKeys: toastJson && typeof toastJson === "object" ? Object.keys(toastJson) : null,
          ordersFound: orders.length,
          totals,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        startDate: startDateRaw, // what you requested
        endDate: endDateRaw,     // what you requested
        normalizedStartDate: startDate,
        normalizedEndDate: endDate,
        ...totals,
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
