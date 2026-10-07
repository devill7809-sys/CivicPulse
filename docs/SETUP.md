# Setup

## 1. Firebase
Create a Firebase project and enable:
- Authentication (Email/Password)
- Cloud Firestore
- Cloud Storage
- Cloud Messaging (for production push notifications)

Download an Android `google-services.json` into `android/app/`.
For the server, use a service-account JSON or environment variables described in `server/.env.example`.

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

## 4. Admin
```bash
cd admin
npm install
npm run dev
```

## 5. Android
Open `android/` in Android Studio, put `google-services.json` in `android/app/`, sync Gradle and run on an emulator/device. Configure the API base URL in `BuildConfig.API_BASE_URL` for your environment.
