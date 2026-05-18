export type MembershipTier = "basic" | "silver" | "gold" | "platinum";
export type MembershipStatus = "active" | "inactive" | "expired" | "suspended";

export interface MembershipPlan {
  id: string;
  ownerId: string;
  clubId: string;
  name: string;
  tier: MembershipTier;
  price: number;
  visitQuota: number;
  durationDays: number;
  benefits: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  ownerId: string;
  clubId: string;
  customerId: string;
  planId: string;
  planName: string;
  tier: MembershipTier;
  status: MembershipStatus;
  visitQuota: number;
  visitUsed: number;
  visitRemaining: number;
  balance: number;
  activatedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipVisit {
  id: string;
  ownerId: string;
  clubId: string;
  membershipId: string;
  customerId: string;
  transactionId: string;
  visitsBefore: number;
  visitsAfter: number;
  requestId: string;
  operationId: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  ownerId: string;
  clubId: string;
  email?: string;
  displayName: string;
  phoneNumber?: string;
  photoURL?: string;
  activeMembershipId?: string;
  totalVisits: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}
