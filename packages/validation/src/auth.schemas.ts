import { z } from "zod";
import { tenantRefSchema } from "./common.schemas";

export const operatorLoginSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
  deviceId: z.string().min(1),
  clubId: z.string().min(1),
  ownerId: z.string().min(1),
});

export const registerDeviceSchema = tenantRefSchema.extend({
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["android", "ios"]),
  fcmToken: z.string().optional(),
});

export const createOperatorSchema = tenantRefSchema.extend({
  displayName: z.string().min(1).max(100),
  pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
  allowedDeviceIds: z.array(z.string()).default([]),
});

export const updateOperatorPinSchema = tenantRefSchema.extend({
  operatorId: z.string().min(1),
  currentPin: z.string().length(6).regex(/^\d{6}$/).optional(),
  newPin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
});

export const initOwnerSchema = z.object({
  displayName: z.string().min(1).max(100),
  clubName: z.string().min(1).max(100),
  clubAddress: z.string().min(1).max(300),
  clubPhoneNumber: z.string().min(1).max(20),
  timezone: z.string().default("Asia/Jakarta"),
});

export const refreshOwnerClaimsSchema = z.object({
  ownerId: z.string().min(1),
  clubId: z.string().min(1),
});

export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;
export type InitOwnerInput = z.infer<typeof initOwnerSchema>;
