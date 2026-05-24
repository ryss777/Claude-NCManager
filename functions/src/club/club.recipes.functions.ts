import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import {
  createRecipeSchema,
  updateRecipeSchema,
  deleteRecipeSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

// ── club_createRecipe ─────────────────────────────────────────────────────────

export const club_createRecipe = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createRecipeSchema, request.data);
  const { ownerId, clubId } = payload;

  // Enforce one recipe per product
  if (payload.linkedProductId) {
    const existing = await db
      .collection(COLLECTIONS.RECIPES(ownerId, clubId))
      .where("linkedProductId", "==", payload.linkedProductId)
      .where("isActive", "==", true)
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new HttpsError(
        "already-exists",
        "Produk ini sudah memiliki resep aktif. Hapus atau ubah resep yang ada terlebih dahulu."
      );
    }
  }

  const ref = db.collection(COLLECTIONS.RECIPES(ownerId, clubId)).doc();
  const now = new Date().toISOString();

  await ref.set({
    id: ref.id,
    ownerId,
    clubId,
    name: payload.name,
    linkedProductId: payload.linkedProductId ?? null,
    linkedProductName: payload.linkedProductName ?? null,
    ingredients: payload.ingredients,
    prices: payload.prices ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { recipeId: ref.id };
});

// ── club_updateRecipe ─────────────────────────────────────────────────────────

export const club_updateRecipe = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(updateRecipeSchema, request.data);
  const { ownerId, clubId, recipeId } = payload;

  const ref = db.collection(COLLECTIONS.RECIPES(ownerId, clubId)).doc(recipeId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Resep tidak ditemukan");

  // If linking to a different product, check uniqueness
  if (payload.linkedProductId !== undefined) {
    const currentLinked = snap.data()!["linkedProductId"] as string | null;
    if (payload.linkedProductId && payload.linkedProductId !== currentLinked) {
      const existing = await db
        .collection(COLLECTIONS.RECIPES(ownerId, clubId))
        .where("linkedProductId", "==", payload.linkedProductId)
        .where("isActive", "==", true)
        .limit(1)
        .get();
      if (!existing.empty && existing.docs[0]!.id !== recipeId) {
        throw new HttpsError("already-exists", "Produk ini sudah memiliki resep aktif.");
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (payload.name !== undefined && payload.name !== null) updates["name"] = payload.name;
  if (payload.linkedProductId !== undefined) updates["linkedProductId"] = payload.linkedProductId ?? null;
  if (payload.linkedProductName !== undefined) updates["linkedProductName"] = payload.linkedProductName ?? null;
  if (payload.ingredients !== undefined && payload.ingredients !== null) updates["ingredients"] = payload.ingredients;
  if (payload.prices !== undefined) updates["prices"] = payload.prices ?? null;

  await ref.update(updates);
  return { recipeId };
});

// ── club_deleteRecipe ─────────────────────────────────────────────────────────

export const club_deleteRecipe = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(deleteRecipeSchema, request.data);
  const { ownerId, clubId, recipeId } = payload;

  const ref = db.collection(COLLECTIONS.RECIPES(ownerId, clubId)).doc(recipeId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Resep tidak ditemukan");

  await ref.update({ isActive: false, updatedAt: new Date().toISOString() });
  return { deleted: true };
});
