from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
import hashlib
import hmac
import io
import json
import logging
import math
import os
import warnings
import numpy as np
from priority import calculate_priority

app = FastAPI(title='CivicPulse AI Service', version='1.0')
logger = logging.getLogger('civicpulse.vision')

CATEGORIES = ['pothole', 'garbage', 'streetlight', 'water leakage', 'drainage', 'damaged road', 'other']
CATEGORY_INPUTS = {category.replace(' ', '_').upper(): category for category in CATEGORIES}
CLIP_LABELS = [
    'a photo of a pothole or road hole',
    'a photo of garbage or unmanaged waste',
    'a photo of a broken streetlight',
    'a photo of water leakage or flooding',
    'a photo of blocked drainage',
    'a photo of a damaged road',
    'a photo of another civic issue'
]
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 5 * 1024 * 1024
MAX_TEXT_LENGTH = 4000
MAX_COMPLAINTS = 300
MAX_IMAGE_PIXELS = 40_000_000
ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP', 'GIF'}
SERVICE_TOKEN_ENV = 'VISION_SERVICE_TOKEN'
SERVICE_TOKEN_HEADER = 'x-civicpulse-service-token'

_clip = None
_text_model = None


class RequestSizeLimitMiddleware:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope.get('path') != '/analyze':
            await self.application(scope, receive, send)
            return

        content_length = next((value for name, value in scope.get('headers', []) if name.lower() == b'content-length'), None)
        if content_length is not None:
            try:
                if int(content_length) > MAX_REQUEST_BYTES:
                    response = JSONResponse({'detail': 'Request body exceeds the supported size limit'}, status_code=413)
                    await response(scope, receive, send)
                    return
            except ValueError:
                response = JSONResponse({'detail': 'Invalid Content-Length header'}, status_code=400)
                await response(scope, receive, send)
                return

        body = bytearray()
        more_body = True
        while more_body:
            message = await receive()
            if message['type'] == 'http.disconnect':
                response = JSONResponse({'detail': 'Incomplete request body'}, status_code=400)
                await response(scope, receive, send)
                return
            if message['type'] != 'http.request':
                continue
            body.extend(message.get('body', b''))
            if len(body) > MAX_REQUEST_BYTES:
                response = JSONResponse({'detail': 'Request body exceeds the supported size limit'}, status_code=413)
                await response(scope, receive, send)
                return
            more_body = message.get('more_body', False)

        sent = False

        async def replay_body():
            nonlocal sent
            if sent:
                return {'type': 'http.request', 'body': b'', 'more_body': False}
            sent = True
            return {'type': 'http.request', 'body': bytes(body), 'more_body': False}

        await self.application(scope, replay_body, send)


app.add_middleware(RequestSizeLimitMiddleware)
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def lazy_models():
    global _clip, _text_model
    if _clip is None:
        from transformers import CLIPProcessor, CLIPModel
        _clip = (CLIPModel.from_pretrained('openai/clip-vit-base-patch32'), CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32'))
    if _text_model is None:
        from sentence_transformers import SentenceTransformer
        _text_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _clip, _text_model


def cosine(a, b):
    a = np.asarray(a)
    b = np.asarray(b)
    denominator = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denominator) if denominator else 0.0


def geo_distance_m(a, b):
    earth_radius = 6371000
    p1, p2 = math.radians(a['lat']), math.radians(b['lat'])
    delta_lat = math.radians(b['lat'] - a['lat'])
    delta_lng = math.radians(b['lng'] - a['lng'])
    value = math.sin(delta_lat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(delta_lng / 2) ** 2
    return 2 * earth_radius * math.asin(math.sqrt(min(1.0, value)))


def severity_from_text(text):
    lowered = text.lower()
    high_terms = ['danger', 'accident', 'injury', 'blocked', 'flood', 'severe', 'major', 'urgent', 'school', 'hospital']
    medium_terms = ['large', 'deep', 'heavy', 'frequent', 'traffic', 'unsafe', 'leak']
    high_count = sum(1 for term in high_terms if term in lowered)
    medium_count = sum(1 for term in medium_terms if term in lowered)
    if high_count >= 2:
        return 'HIGH', 0.9
    if high_count or medium_count >= 2:
        return 'MEDIUM', 0.65
    return 'LOW', 0.4


def validate_existing_complaints(raw_value):
    try:
        complaints = json.loads(raw_value or '[]')
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail='Invalid existing_complaints payload')
    if not isinstance(complaints, list) or len(complaints) > MAX_COMPLAINTS:
        raise HTTPException(status_code=400, detail='Invalid existing_complaints payload')

    validated = []
    for complaint in complaints:
        if not isinstance(complaint, dict):
            continue
        description = complaint.get('description')
        complaint_id = complaint.get('id')
        if (not isinstance(description, str) or not description.strip()
            or not isinstance(complaint_id, str) or not complaint_id or len(complaint_id) > 100):
            continue
        record = {'id': complaint_id, 'description': description[:MAX_TEXT_LENGTH]}
        location = complaint.get('location')
        if isinstance(location, dict):
            latitude = location.get('lat')
            longitude = location.get('lng')
            if (isinstance(latitude, (int, float)) and not isinstance(latitude, bool)
                    and isinstance(longitude, (int, float)) and not isinstance(longitude, bool)
                    and math.isfinite(latitude) and math.isfinite(longitude)
                    and -90 <= latitude <= 90 and -180 <= longitude <= 180):
                record['location'] = {'lat': float(latitude), 'lng': float(longitude)}
        validated.append(record)
    return validated


def decode_image(image_bytes):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(image_bytes)) as candidate:
                if candidate.format not in ALLOWED_IMAGE_FORMATS:
                    raise HTTPException(status_code=415, detail='Unsupported image format')
                candidate.verify()
            with Image.open(io.BytesIO(image_bytes)) as candidate:
                if candidate.width * candidate.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(status_code=413, detail='Image dimensions exceed the supported limit')
                return candidate.convert('RGB')
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning, ValueError):
        raise HTTPException(status_code=400, detail='Invalid or corrupt image')


@app.get('/health')
def health():
    return {'ok': True, 'service': 'civicpulse-ai'}


@app.post('/analyze')
async def analyze(
    image: UploadFile | None = File(None),
    text: str = Form(''),
    category: str = Form(''),
    lat: str = Form(''),
    lng: str = Form(''),
    existing_complaints: str = Form('[]'),
    service_token: str | None = Header(default=None, alias=SERVICE_TOKEN_HEADER),
):
    expected_token = os.environ.get(SERVICE_TOKEN_ENV, '')
    if len(expected_token) < 32 or expected_token.startswith('replace-with-'):
        raise HTTPException(status_code=503, detail='Vision service authentication is not configured')
    if not service_token or not hmac.compare_digest(service_token.encode('utf-8'), expected_token.encode('utf-8')):
        raise HTTPException(status_code=401, detail='Invalid service credentials')

    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=413, detail='Text exceeds the supported size limit')
    requested_input = category.strip().upper()
    if requested_input not in CATEGORY_INPUTS:
        raise HTTPException(status_code=400, detail='Unsupported complaint category')
    requested = CATEGORY_INPUTS[requested_input]

    latitude = parse_coordinate(lat, -90, 90, 'latitude')
    longitude = parse_coordinate(lng, -180, 180, 'longitude')
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=400, detail='Latitude and longitude must be supplied together')

    complaints = validate_existing_complaints(existing_complaints)
    image_bytes = await image.read(MAX_IMAGE_BYTES + 1) if image else None
    if image_bytes is not None and len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail='Image exceeds the supported size limit')
    decoded_image = decode_image(image_bytes) if image_bytes else None

    severity_label, severity_score = severity_from_text(text)
    result = {
        'available': True,
        'model': 'CLIP + sentence-transformers',
        'classification': None,
        'nlp': {'severity': severity_label},
        'evidence_match': None,
        'duplicates': [],
        'priority': None
    }

    try:
        clip, text_model = lazy_models()
        if decoded_image is not None:
            model, processor = clip
            inputs = processor(text=CLIP_LABELS, images=decoded_image, return_tensors='pt', padding=True)
            output = model(**inputs)
            probabilities = output.logits_per_image.softmax(dim=1)[0].detach().cpu().numpy()
            if len(probabilities) != len(CATEGORIES) or not np.isfinite(probabilities).all():
                raise ValueError('Invalid image classification output')
            predicted_index = int(np.argmax(probabilities))
            predicted = CATEGORIES[predicted_index]
            confidence = float(probabilities[predicted_index])
            result['classification'] = {'label': predicted, 'confidence': round(confidence, 3)}
            matches = predicted == requested or (requested == 'damaged road' and predicted == 'pothole')
            result['evidence_match'] = {'match': matches, 'predicted': predicted, 'requested': requested}

        embedding_text = text.strip() or requested
        embedding = text_model.encode(embedding_text, normalize_embeddings=True)
        for complaint in complaints:
            try:
                comparison_embedding = text_model.encode(complaint['description'], normalize_embeddings=True)
                similarity = cosine(embedding, comparison_embedding)
                distance = None
                location = complaint.get('location')
                if latitude is not None and location is not None:
                    distance = geo_distance_m({'lat': latitude, 'lng': longitude}, location)
                if similarity >= 0.82 and (distance is None or distance <= 100):
                    result['duplicates'].append({
                        'complaintId': complaint.get('id'),
                        'textSimilarity': round(similarity, 3),
                        'distanceMeters': round(distance, 1) if distance is not None else None
                    })
            except Exception as error:
                logger.warning('Skipping malformed complaint in AI comparison', extra={'error_type': type(error).__name__})

        result['priority'] = calculate_priority(severity_score, len(result['duplicates']), result['evidence_match'])
    except Exception as error:
        logger.warning('AI model analysis unavailable', extra={'error_type': type(error).__name__})
        return {
            'available': False,
            'error': 'AI analysis is temporarily unavailable.',
            'priority': {'label': 'MEDIUM', 'score': 0.5}
        }
    return result


def parse_coordinate(value, minimum, maximum, name):
    if value == '':
        return None
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f'Invalid {name}')
    if not math.isfinite(coordinate) or not minimum <= coordinate <= maximum:
        raise HTTPException(status_code=400, detail=f'Invalid {name}')
    return coordinate
