import * as admin from "firebase-admin";

export const db = admin.firestore();
export const auth = admin.auth();
export const storage = admin.storage();

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
