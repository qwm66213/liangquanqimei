import { fetchAllProductMeta } from "@/lib/product-meta";
import { cacheGet, cacheSet, STATIC_TTL } from "@/lib/cache";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const cached = cacheGet("product-meta");
    if (cached) return NextResponse.json(cached);

    const items = await fetchAllProductMeta();
    // Return both array (for listing) and map keyed by productCode (for fast lookup)
    const map: Record<string, typeof items[0]> = {};
    for (const item of items) {
      map[item.code] = item;
    }

    const body = { items, map };
    cacheSet("product-meta", body, STATIC_TTL);
    return NextResponse.json(body);
  } catch (e: unknown) {
    console.error("[product-meta]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
