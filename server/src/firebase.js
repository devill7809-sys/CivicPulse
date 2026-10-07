import admin from 'firebase-admin';
import 'dotenv/config';

let app;
const hasFirebaseCredentials = process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();

if (hasFirebaseCredentials && !storageBucket) {
  throw new Error('FIREBASE_STORAGE_BUCKET is required when Firebase Admin credentials are configured');
}

if (hasFirebaseCredentials) {
  app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    }),
    storageBucket
  });
} else {
  console.warn('Firebase Admin credentials are not configured. API will start, but Firestore operations will fail until configured.');
}

export const db = app ? admin.firestore() : null;
export const storage = app ? admin.storage(app).bucket(storageBucket) : null;
export const auth = app ? admin.auth() : null;
export default admin;
