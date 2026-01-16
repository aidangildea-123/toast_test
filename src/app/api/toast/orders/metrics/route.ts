// app/api/toast/orders/bulk/route.ts
import { NextResponse } from "next/server";

/**
 * If you call your own internal API routes from the server (route handlers),
 * you MUST use an absolute URL. This helper makes that easy.
 */
function getOrigin(req: Request) {
  return new URL(req.url).origin;
}

/**
 * ---- Toast auth (replace with YOUR real token logic) ----
 * Options:
 *  - If you already have a working token endpoint, call it here.
 *  - Or read a pre-fetched token from env for quick testing.
 */
async function getToastAccessToken(_req: Request): Promise<string> {
  const token = process.env.TOAST_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "Missing TOAST_ACCESS_TOKEN. Set it in your .env.local or implement getToastAccessToken()."
    );
  }
  return token;
}

/**
 * Pull only the metrics you care about:
 * - grossSales: sum of CAPTURED payment amounts on the check
 * - netSales: check.amount (Toast check subtotal/net in your current mapping)
 * - tax: check.taxAmount
 *
 * Note: Some APIs may use different fields for tax/subtotal/total.
 * Based on your sample payload, check.amount and check.taxAmount exist.
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
        const amt = typeof p?.amount === "number" ? p.amount : Number(p?.amount ?? 0);
        return sum + (Number.isFinite(amt) ? amt : 0);
      }, 0);

      const netSales =
        typeof check?.amount === "number" ? check.amount : Number(check?.amount ?? 0);

      const tax =
        typeof check?.taxAmount === "number"
          ? check.taxAmount
          : Number(check?.taxAmount ?? 0);

      return {
        orderGuid: order?.guid ?? null,
        orderDisplayNumber: order?.displayNumber ?? null,
        businessDate: order?.businessDate ?? null,
        paidDate: order?.paidDate ?? null,

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
 * POST /api/toast/orders/bulk
 *
 * Expected body (example):
 * {
 *   "restaurantGuid": "...",
 *   "startDate": "2026-01-10T00:00:00.000Z",
 *   "endDate": "2026-01-11T00:00:00.000Z",
 *   "page": 1,
 *   "pageSize": 10
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const restaurantGuid = body?.restaurantGuid;
    if (!restaurantGuid) {
      return NextResponse.json(
        { error: "Missing restaurantGuid in request body" },
        { status: 400 }
      );
    }

    // Dates/paging defaults
    const startDate = body?.startDate;
    const endDate = body?.endDate;
    const page = typeof body?.page === "number" ? body.page : 1;
    const pageSize = typeof body?.pageSize === "number" ? body.pageSize : 10;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing startDate or endDate in request body" },
        { status: 400 }
      );
    }

    const token = await getToastAccessToken(req);

    // ---- Toast endpoint (replace with your actual Order Bulk endpoint) ----
    // This is a placeholder shape. If your current code already hits the right URL,
    // keep that URL and just keep the parsing change (extractCheckMetrics).
    const toastBaseUrl =
      process.env.TOAST_BASE_URL || "https://toast-api-server.example.com";

    // If your toast endpoint is something like:
    // `${toastBaseUrl}/orders/v2/ordersBulk`
    // swap it here.
    const toastUrl = `${toastBaseUrl}/orders/bulk`;

    const toastRes = await fetch(toastUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // If Toast requires restaurant guid header, add it here (example):
        // "Toast-Restaurant-External-ID": restaurantGuid,
      },
      body: JSON.stringify({
        startDate,
        endDate,
        page,
        pageSize,
        // If Toast wants restaurantGuid in body, keep it:
        restaurantGuid,
      }),
    });

    const rawText = await toastRes.text();

    // If Toast returns non-JSON on error, this avoids crashing
    let toastJson: any;
    try {
      toastJson = rawText ? JSON.parse(rawText) : null;
    } catch {
      toastJson = { raw: rawText };
    }

    if (!toastRes.ok) {
      return NextResponse.json(
        {
          error: "Toast API error",
          status: toastRes.status,
          details: toastJson,
        },
        { status: toastRes.status }
      );
    }

    // ✅ Key change: return ONLY the metrics you want
    const cleaned = extractCheckMetrics(toastJson);

    return NextResponse.json(cleaned, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Server error",
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

/**
 * Optional GET for quick sanity checks in the browser:
 * /api/toast/orders/bulk?restaurantGuid=...&startDate=...&endDate=...&page=1&pageSize=10
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const restaurantGuid = url.searchParams.get("restaurantGuid");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "10");

    if (!restaurantGuid || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Missing restaurantGuid, startDate, or endDate query params" },
        { status: 400 }
      );
    }

    // Reuse POST logic by calling our own route internally (absolute URL!)
    const origin = getOrigin(req);
    const res = await fetch(`${origin}/api/toast/orders/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantGuid, startDate, endDate, page, pageSize }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Server error", message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
