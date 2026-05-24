import { z } from "zod";
import { tenantRefSchema } from "./common.schemas";

const recipePriceTiersSchema = z.object({
  retail: z.number().min(0),
  ds:     z.number().min(0),
  sc:     z.number().min(0),
  sbQp:   z.number().min(0),
  spv:    z.number().min(0),
});

export type RecipePriceTiers = z.infer<typeof recipePriceTiersSchema>;

export const recipeIngredientSchema = z.object({
  inventoryItemId: z.string().nullish(), // null = free-text ingredient (no stock deduction)
  inventoryItemName: z.string().min(1),
  quantity: z.number().min(0.001),
  unit: z.string().min(1).max(20),
  /**
   * How many base units (g or ml) per 1 of `unit`.
   * e.g. unit="scoop", unitAmount=12.5 → 1 scoop = 12.5 g
   * null = free-text ingredient OR product without serving data (deduct raw quantity)
   */
  unitAmount: z.number().min(0.001).nullish(),
});

export const createRecipeSchema = tenantRefSchema.extend({
  name: z.string().min(1).max(100),
  linkedProductId: z.string().min(1).nullish(),
  linkedProductName: z.string().min(1).nullish(),
  ingredients: z.array(recipeIngredientSchema).min(1),
  prices: recipePriceTiersSchema.nullish(), // harga jual per tier; null = belum diset
});

export const updateRecipeSchema = tenantRefSchema.extend({
  recipeId: z.string().min(1),
  name: z.string().min(1).max(100).nullish(),
  linkedProductId: z.string().nullish(),
  linkedProductName: z.string().nullish(),
  ingredients: z.array(recipeIngredientSchema).min(1).nullish(),
  prices: recipePriceTiersSchema.nullish(),
});

export const deleteRecipeSchema = tenantRefSchema.extend({
  recipeId: z.string().min(1),
});

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
