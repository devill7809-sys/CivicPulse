import admin from 'firebase-admin';
import 'dotenv/config';

const email = process.argv[2];

if (!email) {
  console.error('Usage: npm run admin:set-claim <firebase-user-email>');
  console.error('Run this only from a trusted developer environment with Firebase Admin credentials configured.');
  process.exit(1);
}

if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Missing Firebase Admin environment variables. Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY before running this script.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

const main = async () => {
  const user = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });
  console.log(`Granted admin custom claim to ${email} (uid: ${user.uid}).`);
};

main().catch((error) => {
  console.error('Unable to set Firebase admin claim:', error.message);
  process.exit(1);
});
