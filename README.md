# CivicPulse
AI-based Urban Problem Intelligence System

Citizen Android app + React Admin Web + Node/Express API + Python Vision/NLP service + Firebase/Firestore.

## Architecture
Citizen Android (Kotlin/Compose)
→ Node/Express API
→ Firebase Auth / Firestore / Storage
→ Python FastAPI AI service (CLIP image categories + text similarity and scoring heuristics)
→ React Admin dashboard
→ Firestore realtime listeners / FCM

## Core capabilities
- Firebase authentication
- Citizen complaint creation with text, category, GPS and image evidence
- AI image classification with CLIP-compatible vision service
- Keyword-based severity recommendation and sentence-embedding text similarity
- Heuristic comparison of the predicted image category with the submitted category (not image/text verification)
- Duplicate/related complaint detection using semantic + geographic similarity
- Severity and priority assistance
- Admin queue, filters, complaint detail and status updates
- Real-time Firestore updates
- Notification hook for FCM
- Security rules and protected backend operations
- AI is advisory; administrators make final decisions

## Important
The AI service is designed as a real service, not a fake UI mock. Configure model dependencies before production use. The default server can run without the AI service, but AI fields will be marked unavailable.

## Run
See `docs/SETUP.md`.
