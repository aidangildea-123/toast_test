export default async function Page() {
  // Example week range (YYYYMMDD format)
  const start = "20260101";
  const end = "20260107";

  const res = await fetch(
    `http://localhost:3000/api/toast/sales/revenue-centers?start=${start}&end=${end}`,
    { cache: "no-store" }
  );

  const json = await res.json();

  return (
    <main style={{ padding: 24 }}>
      <h1>Toast Sales by Revenue Center</h1>
      <p>
        Range: {start} → {end}
      </p>
      <pre style={{ background: "#111", color: "#0f0", padding: 16, borderRadius: 8 }}>
        {JSON.stringify(json, null, 2)}
      </pre>
    </main>
  );
}
