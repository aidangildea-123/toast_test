// src/app/api/toast/orders/checks/route.ts
import { NextResponse } from "next/server";
import { getToastAccessToken } from "@/lib/toastAuth";


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
 * Derive Toast businessDate integer (YYYYMMDD) from an ISO-like input.
 * Example: "2026-01-08T00:00:00.000Z" -> 20260108
 */

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
 * Compute check-level metrics.
 * - grossSales: sum CAPTURED payment.amount on the check
 * - netSales: check.amount
 * - tax: check.taxAmount
 */

function sumDiscountsFromDiscountObjects(discounts: any[]): number {
    if (!Array.isArray(discounts)) return 0;
  
    return discounts.reduce((sum: number, d: any) => {
      // common fields you might see
      const raw =
        d?.discountAmount ??
        d?.amount ??
        d?.appliedDiscountAmount ??
        0;
  
      const amt = typeof raw === "number" ? raw : Number(raw ?? 0);
      return sum + (Number.isFinite(amt) ? amt : 0);
    }, 0);
  }
  
  function computeDiscountTotal(check: any): number {
    let total = 0;
  
    // check-level
    total += sumDiscountsFromDiscountObjects(check?.appliedDiscounts);
  
    // item/selection-level (most likely)
    const selections = Array.isArray(check?.selections) ? check.selections : [];
    for (const s of selections) {
      total += sumDiscountsFromDiscountObjects(s?.appliedDiscounts);
    }
  
    return total;
  }
  
function computeCheckMetrics(check: any) {
      
  const payments = Array.isArray(check?.payments) ? check.payments : [];
  const capturedPayments = payments.filter((p: any) => p?.paymentStatus === "CAPTURED");

  const grossSales = capturedPayments.reduce((sum: number, p: any) => {
    const amt = typeof p?.amount === "number" ? p.amount : Number(p?.amount ?? 0);
    return sum + (Number.isFinite(amt) ? amt : 0);
  }, 0);

  const netSales = typeof check?.amount === "number" ? check.amount : Number(check?.amount ?? 0);
  const tax =
    typeof check?.taxAmount === "number" ? check.taxAmount : Number(check?.taxAmount ?? 0);

   // ✅ Discounts (check-level)
   const appliedDiscounts = Array.isArray(check?.appliedDiscounts) ? check.appliedDiscounts : [];
   const discountAmount = appliedDiscounts.reduce((sum: number, d: any) => {
     const amt = typeof d?.discountAmount === "number" ? d.discountAmount : Number(d?.discountAmount ?? 0);
     return sum + (Number.isFinite(amt) ? amt : 0);
   }, 0);

  // Helpful stats
  const paymentCount = payments.length;
  const capturedPaymentCount = capturedPayments.length;

  const discountTotal = computeDiscountTotal(check);

  return {
    grossSales,
    netSales: Number.isFinite(netSales) ? netSales : 0,
    tax: Number.isFinite(tax) ? tax : 0,
    discountAmount,
    discountCount: appliedDiscounts.length,
    paymentCount,
    capturedPaymentCount,
  };
}

/**
 * Pull check rows from orders, but only for orders matching businessDate.
 */
function extractCheckRowsFromOrders(orders: any[], targetBusinessDate: number) {
  const rows: Array<{
    businessDate: number | null;
    orderDisplayNumber: string | number | null;
    checkDisplayNumber: string | number | null;
    grossSales: number;
    netSales: number;
    discountAmount: number;
    discountCount: number;
    tax: number;
    paymentCount: number;
    capturedPaymentCount: number;
  }> = [];

  for (const order of orders) {
    if (!order || typeof order !== "object") continue;

    const bd = Number(order?.businessDate);
    if (!Number.isFinite(bd) || bd !== targetBusinessDate) continue;

    const checks = Array.isArray(order?.checks) ? order.checks : [];
    for (const check of checks) {
      if (!check || typeof check !== "object") continue;

      const m = computeCheckMetrics(check);

       // ✅ FILTER HERE
       if (m.paymentCount <= 0) continue;

      rows.push({
        businessDate: Number.isFinite(bd) ? bd : null,
        orderDisplayNumber: order?.displayNumber ?? null,

        // These fields may/may not exist in your payload; kept as optional for debugging/traceability

        checkDisplayNumber: check?.displayNumber ?? null,
        grossSales: m.grossSales,
        netSales: m.netSales,
        tax: m.tax,
        discountAmount: m.discountAmount,
        discountCount: m.discountCount,
        paymentCount: m.paymentCount,
        capturedPaymentCount: m.capturedPaymentCount,
      });
    }
  }

  return rows;
}

/**
 * Fetch ONE page from Toast ordersBulk.
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
 * GET /api/toast/orders/checks
 *
 * Query:
 * - startDate (required) e.g. 2026-01-08T00:00:00.000Z
 * - endDate   (required) e.g. 2026-01-10T00:00:00.000Z
 * - pageSize  (optional) default 100
 * - maxPages  (optional) default 50
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

    const targetBusinessDate = 20260109;
    if (!Number.isFinite(targetBusinessDate)) {
      return NextResponse.json(
        { error: "Could not derive target businessDate from startDate", startDate: startDateRaw },
        { status: 400 }
      );
    }

    const startDate = normalizeToastDate(startDateRaw);
    const endDate = normalizeToastDate(endDateRaw);

    const token = await getToastAccessToken();

    const allCheckRows: any[] = [];

    // Debug stats
    let pagesFetched = 0;
    let lastPageOrderCount = 0;
    let idsOnlyDetected = false;
    let totalOrdersSeen = 0;
    let totalOrdersMatchedBusinessDate = 0;

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
          {
            error: "Toast ordersBulk failed",
            status: res.status,
            detail: json,
            page,
            targetBusinessDate,
          },
          { status: res.status }
        );
      }

      const orders = extractOrders(json);
      pagesFetched += 1;
      lastPageOrderCount = orders.length;

      // If only IDs, we can't extract check metrics
      const containsOnlyIds = orders.length > 0 && orders.every((x) => typeof x === "string");
      if (containsOnlyIds) {
        idsOnlyDetected = true;
        return NextResponse.json(
          {
            error: "ordersBulk returned only order IDs (no order details to extract checks).",
            targetBusinessDate,
            normalizedStartDate: startDate,
            normalizedEndDate: endDate,
            pageSize,
            page,
            sampleIds: orders.slice(0, 10),
            nextStep:
              "We need a second step: fetch order details for these IDs (ideally with a bulk details endpoint if available) and then extract check metrics.",
          },
          { status: 200 }
        );
      }

      if (orders.length === 0) break;

      const orderObjects = orders.filter((o) => o && typeof o === "object");
      totalOrdersSeen += orderObjects.length;

      const matched = orderObjects.filter(
        (o) => Number(o?.businessDate) === targetBusinessDate
      );
      totalOrdersMatchedBusinessDate += matched.length;

      const checkRows = extractCheckRowsFromOrders(orderObjects, targetBusinessDate);
      allCheckRows.push(...checkRows);

      if (orders.length < pageSize) {
        // next iteration likely returns empty; we'll confirm then break
      }
    }

    const response = {
      startDate: startDateRaw,
      endDate: endDateRaw,
      targetBusinessDate,
      normalizedStartDate: startDate,
      normalizedEndDate: endDate,
      checkCount: allCheckRows.length,
      checks: allCheckRows,
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
          },
          businessDateFiltering: {
            totalOrdersSeen,
            totalOrdersMatchedBusinessDate,
            totalOrdersFilteredOut: totalOrdersSeen - totalOrdersMatchedBusinessDate,
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
