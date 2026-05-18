export interface TenantRef {
  ownerId: string;
  clubId: string;
}

export type UserRole = "owner" | "operator" | "customer";

export interface CustomClaims {
  role: UserRole;
  ownerId: string;
  clubId: string;
  deviceId?: string;
}

export interface Owner {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Club {
  id: string;
  ownerId: string;
  name: string;
  address: string;
  phoneNumber: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RegisteredDevice {
  id: string;
  ownerId: string;
  clubId: string;
  deviceName: string;
  platform: "android" | "ios";
  fcmToken?: string;
  operatorId?: string;
  isActive: boolean;
  lastSeenAt: string;
  registeredAt: string;
}
