export type ProductCategory =
  | "shake"
  | "tea"
  | "aloe"
  | "supplement"
  | "merchandise"
  | "other";

export interface Product {
  id: string;
  ownerId: string;
  clubId: string;
  name: string;
  sku: string;
  category: ProductCategory;
  basePrice: number;
  isActive: boolean;
  imageURL?: string;
  description?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
}

export interface ProductModifier {
  id: string;
  ownerId: string;
  clubId: string;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
}
