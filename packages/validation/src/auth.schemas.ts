import { z } from "zod";

export const operatorLoginSchema = z.object({
  pin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
  deviceId: z.string().min(1),
  clubId: z.string().min(1),
  ownerId: z.string().min(1),
});

export const registerDeviceSchema = z.object({
  deviceName: z.string().min(1).max(100),
  platform: z.enum(["android", "ios"]),
  fcmToken: z.string().optional(),
  clubId: z.string().min(1),
  ownerId: z.string().min(1),
});

export const setOperatorPinSchema = z.object({
  operatorId: z.string().min(1),
  currentPin: z.string().length(6).optional(),
  newPin: z.string().length(6).regex(/^\d{6}$/, "PIN must be 6 digits"),
});

export type OperatorLoginInput = z.infer<typeof operatorLoginSchema>;
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
