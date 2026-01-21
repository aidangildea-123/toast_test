"use client";

import React, { useEffect, useMemo, useState } from "react";

type Restaurant = {
  guid: string;
  name: string;
};

type TotalsResponse = {
  startDate?: string;
  endDate?: string;
  targetBusinessDate?: number;
  businessDate?: number;

  totalGrossSales?: number;
  totalNetSales?: number;
  totalTax?: number;
  totalDiscountAmount?: number;

  orderCount?: number;
  checkCount?: number;
  capturedPaymentCount?: number;

  error?: string;
  message?: string;
  detail?: any;
};

function fmtMoney(n: any) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "$0.00";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtInt(n: any) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString();
}

/**
 * datetime-local returns a "local time" string like "2026-01-09T00:00"
 * We convert it to ISO with timezone via new Date(...).toISOString()
 */
function localDateTimeToISO(dtLocal: string) {
  if (!dtLocal) return "";
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export default function DailySummaryPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [restaurantsError, setRestaurantsError] = useState<string | null>(null);

  const [restaurantGuid, setRestaurantGuid] = useState("");
  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.guid === restaurantGuid),
    [restaurants, restaurantGuid]
  );

  // calendar inputs (local time)
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  // manual business date (YYYYMMDD)
  const [businessDate, setBusinessDate] = useState("20260109");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TotalsResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoadingRestaurants(true);
        setRestaurantsError(null);
  
        // 1) load default restaurant guid from env (server-side)
        const cfgRes = await fetch("/api/toast/config", { cache: "no-store" });
        const cfg = await cfgRes.json();
        const defaultGuid = cfg?.restaurantGuid;
  
        // 2) load restaurants list
        const res = await fetch("/api/toast/restaurants", { cache: "no-store" });
        const data = await res.json();
  
        if (!res.ok) {
          throw new Error(data?.error ?? `Restaurants API failed (${res.status})`);
        }
  
        const list = Array.isArray(data) ? data : data?.restaurants ?? [];
        setRestaurants(list);
  
        // 3) auto-select env restaurant if found
        if (defaultGuid) {
          const match = list.find((r: any) => r.guid === defaultGuid);
          if (match) {
            setRestaurantGuid(match.guid);
            return;
          }
        }
  
        // fallback: pick first
        if (list.length > 0) setRestaurantGuid(list[0].guid);
      } catch (e: any) {
        setRestaurantsError(e?.message ?? String(e));
      } finally {
        setLoadingRestaurants(false);
      }
    })();
  }, []);
  
  async function run() {
    setRunning(true);
    setRunError(null);
    setResult(null);

    try {
      if (!restaurantGuid) throw new Error("Select a restaurant.");
      if (!startLocal || !endLocal) throw new Error("Select both start and end date/time.");
      if (!businessDate || businessDate.length !== 8) throw new Error("Business Date must be YYYYMMDD.");

      const startDate = localDateTimeToISO(startLocal);
      const endDate = localDateTimeToISO(endLocal);
      if (!startDate || !endDate) throw new Error("Invalid start/end date format.");

      const bdNum = Number(businessDate);
      if (!Number.isFinite(bdNum)) throw new Error("Business Date must be numeric YYYYMMDD.");

      const params = new URLSearchParams({
        restaurantGuid,
        startDate,
        endDate,
        businessDate: String(bdNum),
        // optional: debug
        // debug: "1",
      });

      const res = await fetch(`/api/toast/orders/totals?${params.toString()}`, {
        cache: "no-store",
      });

      const data: TotalsResponse = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Totals API failed (${res.status})`);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResult(data);
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  const headerLine = useMemo(() => {
    const name = selectedRestaurant?.name ?? "(unknown restaurant)";
    const bd = businessDate || "(no business date)";
    return `${name}: ${bd}`;
  }, [selectedRestaurant, businessDate]);

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Daily Summary</h1>
        <p className="text-sm text-gray-600">
          Select a restaurant + date range, enter the Business Date (YYYYMMDD), then run.
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Restaurant */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Restaurant</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={restaurantGuid}
              onChange={(e) => setRestaurantGuid(e.target.value)}
              disabled={loadingRestaurants}
            >
              {restaurants.map((r) => (
                <option key={r.guid} value={r.guid}>
                  {r.name}
                </option>
              ))}
            </select>
            {loadingRestaurants && <div className="text-xs text-gray-500">Loading restaurants…</div>}
            {restaurantsError && <div className="text-xs text-red-600">{restaurantsError}</div>}
          </div>

          {/* Business Date */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Business Date (YYYYMMDD)</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value.trim())}
              placeholder="20260109"
              inputMode="numeric"
            />
          </div>

          {/* Start */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Start Date/Time</label>
            <input
              type="datetime-local"
              className="w-full rounded-lg border px-3 py-2"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
          </div>

          {/* End */}
          <div className="space-y-1">
            <label className="text-sm font-medium">End Date/Time</label>
            <input
              type="datetime-local"
              className="w-full rounded-lg border px-3 py-2"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
          </div>
        </div>

        <button
          className="w-full md:w-auto rounded-lg bg-black text-white px-4 py-2 disabled:opacity-60"
          onClick={run}
          disabled={running}
        >
          {running ? "Running…" : "Run"}
        </button>

        {runError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {runError}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="rounded-xl border p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">{headerLine}</h2>
          {result?.startDate && result?.endDate && (
            <div className="text-xs text-gray-500">
              {result.startDate} → {result.endDate}
            </div>
          )}
        </div>

        {!result && <div className="text-sm text-gray-500">No results yet.</div>}

        {result && (
          <ul className="divide-y rounded-lg border">
            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Gross Sales</span>
              <span className="font-medium">{fmtMoney(result.totalGrossSales)}</span>
            </li>
            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Net Sales</span>
              <span className="font-medium">{fmtMoney(result.totalNetSales)}</span>
            </li>
            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Tax</span>
              <span className="font-medium">{fmtMoney(result.totalTax)}</span>
            </li>

            {/* Optional if/when you add it */}
            {typeof result.totalDiscountAmount !== "undefined" && (
              <li className="flex items-center justify-between p-3">
                <span className="text-sm text-gray-700">Discounts</span>
                <span className="font-medium">{fmtMoney(result.totalDiscountAmount)}</span>
              </li>
            )}

            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Orders</span>
              <span className="font-medium">{fmtInt(result.orderCount)}</span>
            </li>
            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Checks</span>
              <span className="font-medium">{fmtInt(result.checkCount)}</span>
            </li>
            <li className="flex items-center justify-between p-3">
              <span className="text-sm text-gray-700">Captured Payments</span>
              <span className="font-medium">{fmtInt(result.capturedPaymentCount)}</span>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}
