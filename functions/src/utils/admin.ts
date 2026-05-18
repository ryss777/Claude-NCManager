import * as admin from "firebase-admin";
import type { Storage } from "firebase-admin/storage";

export const db = admin.firestore();
export const auth = admin.auth();
export const storage: Storage = admin.storage();

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
