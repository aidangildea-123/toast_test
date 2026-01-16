// src/app/api/toast/orders/totals/route.ts
import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

/**
 * Toast wants: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g. 2016-01-01T14:13:12.000+0400)
 * We accept Z (+00:00) and normalize.
 */
function normalizeToastDate(input: string) {
  // If "+" became a space in a query string: "...000 0000" -> "...000+0000"
  input = input.replace(/(\.\d{3}) (\d{4})$/, "$1+$2");

  // ...Z -> ...+0000
  if (input.endsWith("Z")) return input.replace(/Z$/, "+0000");

  // ...+00:00 -> ...+0000
  input = input.replace(/([+-]\d{2}):(\d{2})$/, "$1$2");

  return input;
}

/**
 * Try to extract an "orders array" from whatever shape Toast returns.
 */
function extractOrders(toastJson: any): any[] {
  if (!toastJson) return [];
  if (Array.isArray(toastJson.orders)) return toastJson.orders;
  if (Array.isArray(toastJson.orderIds)) return toastJson.orderIds; // sometimes full objects, sometimes IDs
  if (Array.isArray(toastJson)) return toastJson;
  if (toastJson.data && Array.isArray(toastJson.data.orders)) return toastJson.data.orders;
  return [];
}

/**
 * Adds sums across orders/checks/payments (based on your sample payload).
 * - grossSales: sum CAPTURED payment.amount
 * - netSales: sum check.amount
 * - tax: sum check.taxAmount
 */
function sumTotalsFromOrders(orders: any[]) {
  let totalGrossSales = 0;
  let totalNetSales = 0;
  let totalTax = 0;

  let orderCount = 0;
  let checkCount = 0;
  let capturedPaymentCount = 0;

  for (const order of orders) {
    if (!order || typeof order !== "object") continue; // skip strings/ids

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
 * Fetch ONE page from Toast.
 * NOTE: If Toast returns only IDs (strings), we cannot sum totals without a 2nd details call.
 */
async function fetchOrdersBulkPage(opts: {
  host: string;
  token: string;
  restaurantGuid: string;
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
}) {
  const { host, token, restaurantGuid, startDate, endDate, page, pageSize } = opts;

  const toastUrl =
    `https://${host}/orders/v2/ordersBulk` +
    `?startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    `&pageSize=${encodeURIComponent(String(pageSize))}` +
    `&page=${encodeURIComponent(String(page))}`;

  const res = await fetch(toastUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Toast-Restaurant-External-ID": restaurantGuid,
    },
    cache: "no-store",
  });

  const rawText = await res.text();

  let json: any;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = { raw: rawText };
  }

  return { res, json, toastUrl };
}

/**
 * GET /api/toast/orders/totals
 *
 * Query:
 * - startDate (required) e.g. 2026-01-09T00:00:00.000Z
 * - endDate   (required) e.g. 2026-01-10T00:00:00.000Z
 * - pageSize  (optional) default 100 (Toast may cap; 100 is a safe start)
 * - maxPages  (optional) default 50 (safety cap)
 * - restaurantGuid (optional override; else TOAST_RESTAURANT_GUID)
 * - debug=1 (optional; includes pagination stats)
 */
export async function GET(req: Request) {
  try {
    const host = process.env.TOAST_HOSTNAME;
    if (!host) return NextResponse.json({ error: "Missing TOAST_HOSTNAME" }, { status: 500 });

    const url = new URL(req.url);

    const restaurantGuid =
      url.searchParams.get("restaurantGuid") ?? process.env.TOAST_RESTAURANT_GUID;
    if (!restaurantGuid) {
      return NextResponse.json(
        { error: "Missing TOAST_RESTAURANT_GUID (or pass restaurantGuid=...)" },
        { status: 500 }
      );
    }

    const startDateRaw = url.searchParams.get("startDate");
    const endDateRaw = url.searchParams.get("endDate");
    if (!startDateRaw || !endDateRaw) {
      return NextResponse.json({ error: "Missing startDate or endDate" }, { status: 400 });
    }

    const pageSize = Number(url.searchParams.get("pageSize") ?? "100");
    const maxPages = Number(url.searchParams.get("maxPages") ?? "50");
    const debug = url.searchParams.get("debug") === "1";

    const startDate = normalizeToastDate(startDateRaw);
    const endDate = normalizeToastDate(endDateRaw);

    const token = await getToastAccessToken();

    // Running totals across ALL pages
    let totals = {
      totalGrossSales: 0,
      totalNetSales: 0,
      totalTax: 0,
      orderCount: 0,
      checkCount: 0,
      capturedPaymentCount: 0,
    };

    // Pagination stats
    let pagesFetched = 0;
    let lastPageOrderCount = 0;
    let idsOnlyDetected = false;

    // We stop when a page returns 0 orders (or hits maxPages)
    for (let page = 1; page <= maxPages; page++) {
      const { res, json } = await fetchOrdersBulkPage({
        host,
        token,
        restaurantGuid,
        startDate,
        endDate,
        page,
        pageSize,
      });

      if (!res.ok) {
        return NextResponse.json(
          { error: "Toast ordersBulk failed", status: res.status, detail: json, page },
          { status: res.status }
        );
      }

      const orders = extractOrders(json);
      pagesFetched += 1;
      lastPageOrderCount = orders.length;

      // If this endpoint returns only IDs, we cannot sum without calling order-details.
      const containsOnlyIds = orders.length > 0 && orders.every((x) => typeof x === "string");
      if (containsOnlyIds) {
        idsOnlyDetected = true;
        return NextResponse.json(
          {
            error: "ordersBulk returned only order IDs (no order details to sum).",
            normalizedStartDate: startDate,
            normalizedEndDate: endDate,
            pageSize,
            page,
            sampleIds: orders.slice(0, 10),
            nextStep:
              "We need a second step: fetch order details for these IDs (ideally with a bulk details endpoint if available) and then sum totals.",
          },
          { status: 200 }
        );
      }

      // If no orders came back, we're done (this means previous page was the last real page).
      if (orders.length === 0) break;

      // Add this page’s totals into our running totals.
      const pageTotals = sumTotalsFromOrders(orders);
      totals = {
        totalGrossSales: totals.totalGrossSales + pageTotals.totalGrossSales,
        totalNetSales: totals.totalNetSales + pageTotals.totalNetSales,
        totalTax: totals.totalTax + pageTotals.totalTax,
        orderCount: totals.orderCount + pageTotals.orderCount,
        checkCount: totals.checkCount + pageTotals.checkCount,
        capturedPaymentCount: totals.capturedPaymentCount + pageTotals.capturedPaymentCount,
      };

      // Optional early-stop heuristic:
      // If Toast always returns <= pageSize and the last page was "short", it’s likely the last page.
      // We still do one more request next loop; that request will return 0 and break.
      if (orders.length < pageSize) {
        // do nothing here; the next iteration will confirm with an empty page and then break
      }
    }

    const response = {
      // what you requested
      startDate: startDateRaw,
      endDate: endDateRaw,
      // what we sent to Toast
      normalizedStartDate: startDate,
      normalizedEndDate: endDate,
      // totals across ALL pages fetched
      ...totals,
    };

    if (debug) {
      return NextResponse.json(
        {
          ...response,
          pagination: {
            pageSize,
            maxPages,
            pagesFetched,
            lastPageOrderCount,
            idsOnlyDetected,
            note:
              "We stop after an empty page OR when maxPages is reached. If you suspect more data, raise maxPages.",
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
