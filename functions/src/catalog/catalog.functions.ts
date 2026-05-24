import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireAdmin } from "../utils/validate";
import { createProductCatalogSchema, updateProductCatalogSchema } from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

// ── catalog_createProduct ─────────────────────────────────────────────────────

export const catalog_createProduct = onCall(async (request) => {
  requireAdmin(request);

  const payload = validatePayload(createProductCatalogSchema, request.data);
  const ref = db.collection(COLLECTIONS.PRODUCT_CATALOG).doc();
  const now = new Date().toISOString();

  await ref.set({
    id: ref.id,
    name: payload.name,
    category: payload.category,
    prices: payload.prices,
    // Serving / takaran data (null when not provided)
    netWeight: payload.netWeight ?? null,
    baseUnit: payload.baseUnit ?? null,
    servingsPerContainer: payload.servingsPerContainer ?? null,
    takaran: payload.takaran ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { productId: ref.id };
});

// ── catalog_updateProduct ─────────────────────────────────────────────────────

export const catalog_updateProduct = onCall(async (request) => {
  requireAdmin(request);

  const payload = validatePayload(updateProductCatalogSchema, request.data);
  const { productId, ...fields } = payload;

  const ref = db.collection(COLLECTIONS.PRODUCT_CATALOG).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Product not found");

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (fields.name != null) updates["name"] = fields.name;
  if (fields.category != null) updates["category"] = fields.category;
  if (fields.prices != null) updates["prices"] = fields.prices;
  if (fields.netWeight !== undefined) updates["netWeight"] = fields.netWeight ?? null;
  if (fields.baseUnit !== undefined) updates["baseUnit"] = fields.baseUnit ?? null;
  if (fields.servingsPerContainer !== undefined) updates["servingsPerContainer"] = fields.servingsPerContainer ?? null;
  if (fields.takaran !== undefined) updates["takaran"] = fields.takaran ?? null;

  await ref.update(updates);
  return { productId };
});

// ── catalog_toggleActive ──────────────────────────────────────────────────────

export const catalog_toggleActive = onCall(async (request) => {
  requireAdmin(request);

  const { productId } = request.data as { productId: string };
  if (!productId) throw new HttpsError("invalid-argument", "productId required");

  const ref = db.collection(COLLECTIONS.PRODUCT_CATALOG).doc(productId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Product not found");

  const current = snap.data()!["isActive"] as boolean;
  await ref.update({ isActive: !current, updatedAt: new Date().toISOString() });
  return { isActive: !current };
});
