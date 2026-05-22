import { z } from "zod";
import { tenantRefSchema } from "./common.schemas";

export const recipeIngredientSchema = z.object({
  inventoryItemId: z.string().min(1),
  inventoryItemName: z.string().min(1),
  quantity: z.number().min(0.001),
  unit: z.string().min(1).max(20),
});

export const createRecipeSchema = tenantRefSchema.extend({
  name: z.string().min(1).max(100),
  linkedProductId: z.string().min(1).nullish(),
  linkedProductName: z.string().min(1).nullish(),
  ingredients: z.array(recipeIngredientSchema).min(1),
});

export const updateRecipeSchema = tenantRefSchema.extend({
  recipeId: z.string().min(1),
  name: z.string().min(1).max(100).nullish(),
  linkedProductId: z.string().nullish(),
  linkedProductName: z.string().nullish(),
  ingredients: z.array(recipeIngredientSchema).min(1).nullish(),
});

export const deleteRecipeSchema = tenantRefSchema.extend({
  recipeId: z.string().min(1),
});

export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
