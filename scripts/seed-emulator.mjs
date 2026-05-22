/**
 * Seed script untuk Firebase Emulator.
 * Jalankan setelah emulator aktif:
 *
 *   node scripts/seed-emulator.mjs
 *
 * Data yang dibuat:
 *   - Owner: owner@demo.com / UID: owner-demo-001
 *   - Club: club-demo-001 ("Demo Klub Nutrisi")
 *   - Operator: op-001 / PIN: 123456 / Nama: Andi Operator
 *   - Device: device-001
 *   - 3 inventory items di GUDANG OWNER (owners/owner-demo-001/inventoryItems)
 *     Stok club kosong — diisi via Transfer Produk.
 */

import { createHash, randomBytes } from "crypto";
import { initializeApp, cert, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── Arahkan firebase-admin ke emulator ──────────────────────────────────────
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const PROJECT_ID = "demo-ncmanager";

initializeApp({ projectId: PROJECT_ID });

const auth = getAuth();
const db = getFirestore();

// ── Konstanta data test ──────────────────────────────────────────────────────
const OWNER_UID = "owner-demo-001";
const OWNER_EMAIL = "owner@demo.com";
const CLUB_ID = "club-demo-001";
const OPERATOR_ID = "op-001";
const OPERATOR_PIN = "123456";
const DEVICE_ID = "device-001";

// ── Helpers PIN ──────────────────────────────────────────────────────────────
function generateSalt() {
  return randomBytes(16).toString("hex");
}

function hashPin(pin, salt) {
  return createHash("sha256").update(salt + pin).digest("hex");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Seeding Firebase Emulator...\n");

  // 1. Buat owner di Firebase Auth
  try {
    await auth.deleteUser(OWNER_UID);
  } catch {
    // belum ada — ok
  }

  await auth.createUser({
    uid: OWNER_UID,
    email: OWNER_EMAIL,
    displayName: "Demo Owner",
    emailVerified: true,
  });

  await auth.setCustomUserClaims(OWNER_UID, {
    role: "owner",
    ownerId: OWNER_UID,
    clubId: CLUB_ID,
  });

  console.log(`✅ Auth: ${OWNER_EMAIL} (uid: ${OWNER_UID})`);

  // 2. Dokumen owner
  await db.doc(`owners/${OWNER_UID}`).set({
    email: OWNER_EMAIL,
    displayName: "Demo Owner",
    defaultClubId: CLUB_ID,
    createdAt: new Date().toISOString(),
  });

  console.log(`✅ Firestore: owners/${OWNER_UID}`);

  // 3. Dokumen club
  await db.doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}`).set({
    name: "Demo Klub Nutrisi",
    ownerId: OWNER_UID,
    timezone: "Asia/Jakarta",
    currency: "IDR",
    createdAt: new Date().toISOString(),
  });

  console.log(`✅ Firestore: clubs/${CLUB_ID}`);

  // 4. Operator dengan PIN ter-hash
  const salt = generateSalt();
  const pinHash = hashPin(OPERATOR_PIN, salt);
  const operatorUid = `operator_${OWNER_UID}_${OPERATOR_ID}`;

  // Hapus operator Auth lama kalau ada
  try {
    await auth.deleteUser(operatorUid);
  } catch {
    // belum ada — ok
  }

  await db
    .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/operators/${OPERATOR_ID}`)
    .set({
      operatorId: OPERATOR_ID,
      displayName: "Andi Operator",
      pinHash,
      pinSalt: salt,
      role: "operator",
      isActive: true,
      allowedDeviceIds: [DEVICE_ID],
      createdAt: new Date().toISOString(),
    });

  console.log(`✅ Firestore: operators/${OPERATOR_ID} (PIN: ${OPERATOR_PIN})`);

  // 5. Registered device
  await db
    .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/registeredDevices/${DEVICE_ID}`)
    .set({
      deviceId: DEVICE_ID,
      name: "Tablet Kasir 1",
      isActive: true,
      registeredAt: new Date().toISOString(),
    });

  console.log(`✅ Firestore: devices/${DEVICE_ID}`);

  // 6. Contoh paket membership
  await db
    .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/membershipPlans/plan-silver`)
    .set({
      id: "plan-silver",
      ownerId: OWNER_UID,
      clubId: CLUB_ID,
      name: "Paket Silver",
      tier: "silver",
      visitQuota: 20,
      durationDays: 30,
      price: 250000,
      benefits: ["20 kunjungan", "Berlaku 30 hari"],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

  await db
    .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/membershipPlans/plan-gold`)
    .set({
      id: "plan-gold",
      ownerId: OWNER_UID,
      clubId: CLUB_ID,
      name: "Paket Gold",
      tier: "gold",
      visitQuota: 50,
      durationDays: 30,
      price: 500000,
      benefits: ["50 kunjungan", "Berlaku 30 hari", "Akses semua fasilitas"],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

  console.log(`✅ Firestore: membership plans (silver, gold)`);

  // 7. Contoh produk di gudang owner (bukan stok club)
  //    Stok club hanya terisi lewat Transfer Produk dari gudang owner ke club.
  const now7 = new Date().toISOString();
  const products = [
    {
      id: "item-001", name: "Protein Shake Vanilla", unit: "botol",
      category: "Inner Nutrition", currentStock: 50, minimumStock: 5,
      prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 },
    },
    {
      id: "item-002", name: "Protein Shake Coklat", unit: "botol",
      category: "Inner Nutrition", currentStock: 30, minimumStock: 5,
      prices: { retail: 553198, ds: 427125, sc: 376695, sbQp: 341394, spv: 301050 },
    },
    {
      id: "item-003", name: "Energy Bar", unit: "pcs",
      category: "Accessories", currentStock: 100, minimumStock: 10,
      prices: { retail: 15000, ds: 15000, sc: 15000, sbQp: 15000, spv: 15000 },
    },
  ];

  for (const p of products) {
    await db
      .doc(`owners/${OWNER_UID}/inventoryItems/${p.id}`)
      .set({
        id: p.id,
        ownerId: OWNER_UID,
        name: p.name,
        unit: p.unit,
        category: p.category,
        prices: p.prices,
        currentStock: p.currentStock,
        minimumStock: p.minimumStock,
        isActive: true,
        createdAt: now7,
        updatedAt: now7,
      });
  }

  console.log(`✅ Firestore: ${products.length} inventory items (gudang owner)`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Seed selesai! Data test:

  Owner Email : ${OWNER_EMAIL}
  Owner UID   : ${OWNER_UID}
  Club ID     : ${CLUB_ID}
  Operator ID : ${OPERATOR_ID}
  PIN Operator: ${OPERATOR_PIN}
  Device ID   : ${DEVICE_ID}

  Emulator UI : http://localhost:4000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

seed().catch((err) => {
  console.error("❌ Seed gagal:", err);
  process.exit(1);
});
