export const COLLECTIONS = {
  PRODUCT_CATALOG: "productCatalog",
  OWNERS: "owners",
  CLUBS: (ownerId: string) => `owners/${ownerId}/clubs`,
  OPERATORS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/operators`,
  REGISTERED_DEVICES: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/registeredDevices`,
  PRODUCTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/products`,
  CUSTOMERS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/customers`,
  MEMBERSHIPS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/memberships`,
  MEMBERSHIP_PLANS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/membershipPlans`,
  MEMBERSHIP_VISITS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/membershipVisits`,
  TRANSACTIONS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/transactions`,
  SHIFTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/shifts`,
  INVENTORY_ITEMS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/inventoryItems`,
  INVENTORY_MOVEMENTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/inventoryMovements`,
  FINANCE_JOURNAL: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/financeJournal`,
  REPLENISHMENTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/replenishments`,
  PRODUCT_TRANSFERS: (ownerId: string) => `owners/${ownerId}/productTransfers`,
  CUSTOMER_NOTIFICATIONS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/customerNotifications`,
  EVENTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/events`,
  OWNER_NOTIFICATIONS: (ownerId: string) =>
    `owners/${ownerId}/notifications`,
  DEBTS: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/debts`,
  RECIPES: (ownerId: string, clubId: string) =>
    `owners/${ownerId}/clubs/${clubId}/recipes`,
} as const;
