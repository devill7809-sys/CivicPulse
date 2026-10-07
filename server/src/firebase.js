import admin from 'firebase-admin';
import 'dotenv/config';

let app;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
} else {
  console.warn('Firebase Admin credentials are not configured. API will start, but Firestore operations will fail until configured.');
}

export const db = app ? admin.firestore() : null;
export const storage = app ? admin.storage() : null;
export const auth = app ? admin.auth() : null;
export default admin;
