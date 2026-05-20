/**
 * Seed katalog produk Herbalife ke emulator.
 * Jalankan setelah emulator aktif:
 *
 *   node scripts/seed-catalog.mjs
 *
 * Data yang dibuat:
 *   - 18 produk di koleksi global `productCatalog`
 *   - 18 inventoryItems di club-demo-001 (stok awal 0)
 */

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const PROJECT_ID = "demo-ncmanager";
const OWNER_ID   = "owner-demo-001";
const CLUB_ID    = "club-demo-001";

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// ── Data produk ───────────────────────────────────────────────────────────────

const products = [
  // Inner Nutrition — F1
  { name: "F1 - French Vanilla",    category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  { name: "F1 - Dutch Chocolate",   category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  { name: "F1 - Wild Berry",        category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  { name: "F1 - Mint Chocolate",    category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  { name: "F1 - Cookies N Cream",   category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  { name: "F1 - Cafe Latte",        category: "Inner Nutrition", prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 } },
  // Inner Nutrition — lainnya
  { name: "F2 - Multivitamin Mineral Herbal Tablet", category: "Inner Nutrition", prices: { retail: 592099, ds: 457275, sc: 403345, sbQp: 365594, spv: 322450 } },
  { name: "F3 - Personalized Protein Powder",        category: "Inner Nutrition", prices: { retail: 519198, ds: 400975, sc: 353685, sbQp: 320582, spv: 282750 } },
  { name: "Herbalifeline 1000",                      category: "Inner Nutrition", prices: { retail: 639703, ds: 494025, sc: 435755, sbQp: 394966, spv: 348350 } },
  { name: "H24 - RS Pro",                            category: "Inner Nutrition", prices: { retail: 1212099, ds: 968375, sc: 870885, sbQp: 802642, spv: 724650 } },
  // Outer Nutrition
  { name: "Soothing Aloe Cleanser",  category: "Outer Nutrition", prices: { retail: 379396, ds: 293000, sc: 258440, sbQp: 234248, spv: 206600 } },
  { name: "Daily Glow Moisturizer",  category: "Outer Nutrition", prices: { retail: 640901, ds: 494950, sc: 436570, sbQp: 395704, spv: 349000 } },
  { name: "Basic Program",           category: "Outer Nutrition", prices: { retail: 2330099, ds: 1799900, sc: 1587820, sbQp: 1439364, spv: 1269700 } },
  // Accessories — harga sama semua tier
  { name: "HMP - Member Kit",   category: "Accessories", prices: { retail: 546000,  ds: 546000,  sc: 546000,  sbQp: 546000,  spv: 546000  } },
  { name: "AMSF - Member",      category: "Accessories", prices: { retail: 111000,  ds: 111000,  sc: 111000,  sbQp: 111000,  spv: 111000  } },
  { name: "AMSF - Supervisor",  category: "Accessories", prices: { retail: 699550,  ds: 699550,  sc: 699550,  sbQp: 699550,  spv: 699550  } },
  { name: "Water Bottle 1L",    category: "Accessories", prices: { retail: 103121,  ds: 103121,  sc: 103121,  sbQp: 103121,  spv: 103121  } },
  { name: "Water Bottle 2L",    category: "Accessories", prices: { retail: 151096,  ds: 151096,  sc: 151096,  sbQp: 151096,  spv: 151096  } },
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`\n🌱 Seeding ${products.length} produk ke emulator...\n`);

  const now = new Date().toISOString();
  const invBase = `owners/${OWNER_ID}/clubs/${CLUB_ID}/inventoryItems`;

  // Cek apakah katalog sudah ada
  const existingSnap = await db.collection("productCatalog").limit(1).get();
  if (!existingSnap.empty) {
    console.log("⚠️  Katalog sudah ada data. Hapus dulu di Emulator UI jika ingin seed ulang.");
    console.log("   http://localhost:4000/firestore\n");
  }

  let created = 0;
  for (const p of products) {
    // 1. Tulis ke katalog global
    const catalogRef = db.collection("productCatalog").doc();
    await catalogRef.set({
      id: catalogRef.id,
      name: p.name,
      category: p.category,
      prices: p.prices,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Tulis ke inventaris club
    const invRef = db.collection(invBase).doc();
    await invRef.set({
      id: invRef.id,
      ownerId: OWNER_ID,
      clubId: CLUB_ID,
      productCatalogId: catalogRef.id,
      name: p.name,
      category: p.category,
      prices: p.prices,
      unit: p.category === "Accessories" ? "pcs" : "kaleng",
      currentStock: 0,
      minimumStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`  ✓ ${p.name}`);
    created++;
  }

  console.log(`\n✅ Selesai! ${created} produk berhasil ditambahkan.`);
  console.log("   Cek di: http://localhost:4000/firestore\n");
}

seed().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
