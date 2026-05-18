/**
 * Seed script untuk Firebase Emulator.
 * Jalankan setelah emulator aktif:
 *
 *   node scripts/seed-emulator.mjs
 *
 * Data yang dibuat:
 *   - Owner: owner@demo.com / UID: owner-demo-001
 *   - Club: club-demo-001 ("Demo Klub")
 *   - Operator: op-001 / PIN: 123456 / Nama: Andi Operator
 *   - Device: device-001
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
      name: "Andi Operator",
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
      planId: "plan-silver",
      planName: "Paket Silver",
      visitQuota: 20,
      durationDays: 30,
      price: 250000,
      description: "20 kunjungan, berlaku 30 hari",
      isActive: true,
      createdAt: new Date().toISOString(),
    });

  await db
    .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/membershipPlans/plan-gold`)
    .set({
      planId: "plan-gold",
      planName: "Paket Gold",
      visitQuota: 50,
      durationDays: 30,
      price: 500000,
      description: "50 kunjungan, berlaku 30 hari",
      isActive: true,
      createdAt: new Date().toISOString(),
    });

  console.log(`✅ Firestore: membership plans (silver, gold)`);

  // 7. Contoh produk inventory
  const products = [
    { id: "prod-001", name: "Protein Shake Vanilla", currentStock: 50, unit: "botol" },
    { id: "prod-002", name: "Protein Shake Coklat", currentStock: 30, unit: "botol" },
    { id: "prod-003", name: "Energy Bar", currentStock: 100, unit: "pcs" },
  ];

  for (const p of products) {
    await db
      .doc(`owners/${OWNER_UID}/clubs/${CLUB_ID}/inventoryItems/${p.id}`)
      .set({
        ...p,
        price: 45000,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
  }

  console.log(`✅ Firestore: ${products.length} inventory items`);

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
