export interface Operator {
  id: string;
  ownerId: string;
  clubId: string;
  displayName: string;
  pin: string;
  isActive: boolean;
  allowedDeviceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperatorSession {
  operatorId: string;
  deviceId: string;
  clubId: string;
  ownerId: string;
  shiftId?: string;
  loginAt: string;
  expiresAt: string;
}
