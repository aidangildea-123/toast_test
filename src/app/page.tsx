type Restaurant = {
  restaurantGuid?: string;
  name?: string;
  locationName?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
};

function getBaseUrl() {
  // Works on Vercel + locally
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function getRestaurants(): Promise<Restaurant[]> {
  const baseUrl = getBaseUrl();

  const res = await fetch(`${baseUrl}/api/toast/restaurants`, {
    cache: "no-store",
  });

  const data = await res.json();

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.restaurants)) return data.restaurants;
  return data ? [data] : [];
}

export default async function Page() {
  const restaurants = await getRestaurants();

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold">Restaurants</h1>
        <p className="mt-1 text-sm text-gray-500">Pulled from Toast (server-side)</p>

        <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200">
          <ul className="divide-y divide-gray-200">
            {restaurants.map((r, idx) => {
              const title = r.name ?? r.locationName ?? "Unnamed Restaurant";
              const subtitle = [r.address1, r.city, r.state, r.zip].filter(Boolean).join(", ");

              return (
                <li key={r.restaurantGuid ?? idx}>
                  <div className="flex items-center justify-between px-4 py-4 hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="truncate text-base font-medium text-gray-900">{title}</div>
                      <div className="mt-1 truncate text-sm text-gray-500">
                        {subtitle || r.restaurantGuid || ""}
                      </div>
                    </div>
                    <div className="ml-4 text-gray-400" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path
                          d="M7.5 5l5 5-5 5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>
                </li>
              );
            })}

            {restaurants.length === 0 && (
              <li className="px-4 py-6 text-sm text-gray-500">No restaurants returned.</li>
            )}
          </ul>
        </div>
      </div>
    </main>
  );
}
