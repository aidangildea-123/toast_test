// src/app/api/toast/orders/totals-by-checks/route.ts
import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";

// ✅ Keep this as manual input
const targetBusinessDate = 20260109;

/** Toast wants: yyyy-MM-dd'T'HH:mm:ss.SSSZ (e.g. 2016-01-01T14:13:12.000+0400) */
function normalizeToastDate(input: string) {
  input = input.replace(/(\.\d{3}) (\d{4})$/, "$1+$2"); // "...000 0000" -> "...000+0000"
  if (input.endsWith("Z")) return input.replace(/Z$/, "+0000"); // Z -> +0000
  return input.replace(/([+-]\d{2}):(\d{2})$/, "$1$2"); // +00:00 -> +0000
}

function extractOrders(toastJson: any): any[] {
  if (!toastJson) return [];
  if (Array.isArray(toastJson.orders)) return toastJson.orders;
  if (Array.isArray(toastJson.orderIds)) return toastJson.orderIds;
  if (Array.isArray(toastJson)) return toastJson;
  if (toastJson.data && Array.isArray(toastJson.data.orders)) return toastJson.data.orders;
  return [];
}

function computeCheckMetrics(check: any) {
  const payments = Array.isArray(check?.payments) ? check.payments : [];
  const captured = payments.filter((p: any) => p?.paymentStatus === "CAPTURED");

  const grossSales = captured.reduce((sum: number, p: any) => {
    const amt = typeof p?.amount === "number" ? p.amount : Number(p?.amount ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

  const net = typeof check?.amount === "number" ? check.amount : Number(check?.amount ?? 0);
  const tax = typeof check?.taxAmount === "number" ? check.taxAmount : Number(check?.taxAmount ?? 0);

  return {
    grossSales,
    netSales: Number.isFinite(net) ? net : 0,
    tax: Number.isFinite(tax) ? tax : 0,
    paymentCount: payments.length,
    capturedPaymentCount: captured.length,
  };
}

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
 * GET /api/toast/orders/totals-by-checks
 *
 * Query:
 * - startDate (required) e.g. 2026-01-09T00:00:00.000Z
 * - endDate   (required) e.g. 2026-01-10T00:00:00.000Z
 * - pageSize  (optional) default 100
 * - maxPages  (optional) default 50
 * - restaurantGuid (optional override; else TOAST_RESTAURANT_GUID)
 * - debug=1 (optional)
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

    // Running totals (streaming, no big arrays)
    let totals = {
      totalGrossSales: 0,
      totalNetSales: 0,
      totalTax: 0,
      checkCount: 0,
      paymentCountTotal: 0,
      capturedPaymentCountTotal: 0,
    };

    // Debug stats
    let pagesFetched = 0;
    let lastPageOrderCount = 0;
    let idsOnlyDetected = false;
    let totalOrdersSeen = 0;
    let totalOrdersMatchedBusinessDate = 0;
    let totalChecksEvaluated = 0;
    let totalChecksIncluded = 0; // paymentCount > 0

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
          { error: "Toast ordersBulk failed", status: res.status, detail: json, page, targetBusinessDate },
          { status: res.status }
        );
      }

      const orders = extractOrders(json);
      pagesFetched += 1;
      lastPageOrderCount = orders.length;

      const containsOnlyIds = orders.length > 0 && orders.every((x) => typeof x === "string");
      if (containsOnlyIds) {
        idsOnlyDetected = true;
        return NextResponse.json(
          {
            error: "ordersBulk returned only order IDs (no order details to sum).",
            targetBusinessDate,
            normalizedStartDate: startDate,
            normalizedEndDate: endDate,
            pageSize,
            page,
            sampleIds: orders.slice(0, 10),
          },
          { status: 200 }
        );
      }

      if (orders.length === 0) break;

      const orderObjects = orders.filter((o) => o && typeof o === "object");
      totalOrdersSeen += orderObjects.length;

      for (const order of orderObjects) {
        const bd = Number(order?.businessDate);
        if (!Number.isFinite(bd) || bd !== targetBusinessDate) continue;
        totalOrdersMatchedBusinessDate += 1;

        const checks = Array.isArray(order?.checks) ? order.checks : [];
        for (const check of checks) {
          if (!check || typeof check !== "object") continue;

          totalChecksEvaluated += 1;
          const m = computeCheckMetrics(check);

          // ✅ your rule: only include checks where paymentCount > 0
          if (m.paymentCount <= 0) continue;

          totalChecksIncluded += 1;

          totals.totalGrossSales += m.grossSales;
          totals.totalNetSales += m.netSales;
          totals.totalTax += m.tax;
          totals.checkCount += 1;
          totals.paymentCountTotal += m.paymentCount;
          totals.capturedPaymentCountTotal += m.capturedPaymentCount;
        }
      }
    }

    const response = {
      startDate: startDateRaw,
      endDate: endDateRaw,
      targetBusinessDate,
      normalizedStartDate: startDate,
      normalizedEndDate: endDate,
      ...totals,
    };

    if (debug) {
      return NextResponse.json(
        {
          ...response,
          pagination: { pageSize, maxPages, pagesFetched, lastPageOrderCount, idsOnlyDetected },
          filtering: {
            totalOrdersSeen,
            totalOrdersMatchedBusinessDate,
            totalChecksEvaluated,
            totalChecksIncluded,
            totalChecksFilteredOut: totalChecksEvaluated - totalChecksIncluded,
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
