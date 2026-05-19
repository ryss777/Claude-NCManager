export type CustomerTier = "retail" | "ds" | "sc" | "sbQp" | "spv";

export interface PriceTiers {
  retail: number;
  ds: number;
  sc: number;
  sbQp: number;
  spv: number;
}

export interface ProductCatalog {
  id: string;
  name: string;
  category: string;
  prices: PriceTiers;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MovementType =
  | "sale"
  | "restock"
  | "adjustment"
  | "waste"
  | "transfer_in"
  | "transfer_out"
  | "opening_stock"
  | "reversal";

export interface InventoryItem {
  id: string;
  ownerId: string;
  clubId: string;
  productCatalogId: string | null;
  name: string;
  category: string | null;
  prices: PriceTiers;
  unit: string;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  ownerId: string;
  clubId: string;
  inventoryItemId: string;
  itemName: string;
  movementType: MovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  unitCost: number;
  totalCost: number;
  referenceId?: string;
  referenceType?: "transaction" | "shift" | "manual" | "transfer";
  operatorId?: string;
  notes?: string;
  requestId: string;
  operationId: string;
  createdAt: string;
}

export interface StockSummary {
  inventoryItemId: string;
  itemName: string;
  currentStock: number;
  minimumStock: number;
  isLow: boolean;
  lastMovementAt: string;
}
