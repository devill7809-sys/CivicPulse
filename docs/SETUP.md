# Setup

## 1. Firebase
Create a Firebase project and enable:
- Authentication (Email/Password)
- Cloud Firestore
- Cloud Storage
- Cloud Messaging (for production push notifications)

Download an Android `google-services.json` into `android/app/`.
Do not commit `google-services.json`; it contains project-specific configuration and is intentionally ignored by Git.

For the server, copy `server/.env.example` to `server/.env` and provide real values for
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and
`FIREBASE_STORAGE_BUCKET`. Supply these credentials externally and never commit `.env`.
The current server implementation reads environment variables; a service-account JSON file is not required or loaded.

Set `VISION_SERVICE_TOKEN` to the same externally supplied random secret in the server and vision-service environments. The server sends it only to the internal `/analyze` endpoint; do not expose it to browser/mobile clients or commit real values. Keep the vision service on a private network as an additional deployment boundary.

Deploy the Firestore and Storage rules from the repository root after replacing the
placeholder default project in `.firebaserc` or selecting a project explicitly:

```bash
firebase deploy --only firestore:rules,storage
```

## 2. Server
```bash
cd server
npm install
cp .env.example .env
npm run dev
```
API: `http://localhost:5000`

## 3. AI service
Python 3.11+ recommended.
```bash
cd vision-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8001 --reload
```
The first model request downloads model weights. For a small demo machine, use CPU and expect slower inference.
Configure `VISION_SERVICE_TOKEN` in the vision-service process environment before starting it. The Python service does not automatically load `.env` files; `vision-service/.env.example` documents the required variable for your deployment secret manager or process supervisor.

## 4. Admin
```bash
cd admin
npm install
npm run dev
```
The admin API defaults to `http://localhost:5000/api`. Set `VITE_API_BASE_URL` in
`admin/.env` to the deployed API base URL when building for production.

## 5. Android
Open `android/` in Android Studio, put `google-services.json` in `android/app/`, sync Gradle and run on an emulator/device. Debug builds default to `http://10.0.2.2:5000/api` for the Android emulator. Override this with the Gradle property `civicpulseApiBaseUrl`, for example:

```bash
./gradlew assembleRelease -PcivicpulseApiBaseUrl=https://<your-api-host>/api
```

Release builds require this property to use HTTPS. Do not commit production API URLs or Firebase configuration files.
