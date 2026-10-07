import asyncio
import io
import json
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from priority import calculate_priority

try:
    import numpy as np
    from PIL import Image
    import app as vision_app
    from app import MAX_IMAGE_BYTES, MAX_REQUEST_BYTES, RequestSizeLimitMiddleware
    IMPORT_ERROR = None
except ModuleNotFoundError as error:
    IMPORT_ERROR = error


class PriorityTests(unittest.TestCase):
    def test_priority_with_image_match_preserves_existing_formula(self):
        self.assertEqual(calculate_priority(0.9, 0, {'match':True}), {'label':'MEDIUM', 'score':0.695})

    def test_priority_without_image_is_deterministic(self):
        self.assertEqual(calculate_priority(0.4, 0, None), {'label':'LOW', 'score':0.42})

    def test_missing_and_malformed_evidence_match_are_safe(self):
        expected = {'label':'MEDIUM', 'score':0.585}
        self.assertEqual(calculate_priority(0.7, 0), expected)
        self.assertEqual(calculate_priority(0.7, 0, {'match':'not-a-bool'}), expected)


def multipart(fields, image=None):
    boundary = 'civicpulse-test-boundary'
    chunks = []
    for name, value in fields.items():
        chunks.extend([
            f'--{boundary}\r\n'.encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode(),
            b'\r\n'
        ])
    if image is not None:
        filename, content_type, content = image
        chunks.extend([
            f'--{boundary}\r\n'.encode(),
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode(),
            f'Content-Type: {content_type}\r\n\r\n'.encode(),
            content,
            b'\r\n'
        ])
    chunks.append(f'--{boundary}--\r\n'.encode())
    return boundary, b''.join(chunks)


def call_asgi(application, path, fields=None, token=None, image=None, raw_body=None, content_length=None):
    boundary, body = multipart(fields or {
        'text':'', 'category':'POTHOLE', 'lat':'', 'lng':'', 'existing_complaints':'[]'
    }, image)
    if raw_body is not None:
        body = raw_body
    headers = [(b'content-type', f'multipart/form-data; boundary={boundary}'.encode())]
    if token is not None:
        headers.append((b'x-civicpulse-service-token', token.encode()))
    length = content_length if content_length is not None else len(body)
    headers.append((b'content-length', str(length).encode()))
    scope = {
        'type':'http', 'asgi':{'version':'3.0'}, 'http_version':'1.1', 'method':'POST',
        'scheme':'http', 'path':path, 'raw_path':path.encode(), 'query_string':b'',
        'headers':headers, 'server':('test', 80), 'client':('127.0.0.1', 12345), 'root_path':''
    }
    messages = [{'type':'http.request', 'body':body, 'more_body':False}]
    sent = []

    async def receive():
        return messages.pop(0) if messages else {'type':'http.disconnect'}

    async def send(message):
        sent.append(message)

    asyncio.run(application(scope, receive, send))
    status = next(message['status'] for message in sent if message['type'] == 'http.response.start')
    response_body = b''.join(message.get('body', b'') for message in sent if message['type'] == 'http.response.body')
    return status, json.loads(response_body) if response_body else {}


@unittest.skipIf(IMPORT_ERROR is not None, f'vision dependencies unavailable: {IMPORT_ERROR}')
class VisionServiceTests(unittest.TestCase):
    TEST_TOKEN = 'test-only-service-token-0123456789abcdef'

    def setUp(self):
        self.environment = patch.dict(os.environ, {'VISION_SERVICE_TOKEN':self.TEST_TOKEN})
        self.environment.start()
        self.client_app = RequestSizeLimitMiddleware(vision_app.app)
        self.model_patch = patch.object(vision_app, 'lazy_models', self.fake_models)
        self.model_patch.start()

    def tearDown(self):
        self.model_patch.stop()
        self.environment.stop()

    @staticmethod
    def fake_models():
        class TextModel:
            def encode(self, _text, normalize_embeddings=True):
                return np.array([1.0, 0.0])

        class Tensor:
            def __init__(self, values):
                self.values = values
            def detach(self): return self
            def cpu(self): return self
            def numpy(self): return np.array(self.values)

        class Probabilities:
            def __getitem__(self, _index):
                return Tensor([0.9, 0.02, 0.02, 0.02, 0.01, 0.02, 0.01])

        class Logits:
            def softmax(self, dim): return Probabilities()

        class VisionModel:
            def __call__(self, **_inputs):
                return type('Output', (), {'logits_per_image':Logits()})()

        def processor(**_kwargs):
            return {}

        return (VisionModel(), processor), TextModel()

    @staticmethod
    def png_bytes():
        buffer = io.BytesIO()
        Image.new('RGB', (2, 2), color='red').save(buffer, format='PNG')
        return buffer.getvalue()

    def test_authenticated_valid_image_returns_analysis(self):
        status, response = call_asgi(
            self.client_app, '/analyze', token=self.TEST_TOKEN,
            image=('report.png', 'image/png', self.png_bytes())
        )
        self.assertEqual(status, 200)
        self.assertTrue(response['available'])
        self.assertEqual(response['classification']['label'], 'pothole')
        self.assertGreaterEqual(response['priority']['score'], 0)

    def test_no_image_produces_valid_priority(self):
        status, response = call_asgi(self.client_app, '/analyze', token=self.TEST_TOKEN)
        self.assertEqual(status, 200)
        self.assertTrue(response['available'])
        self.assertIsNone(response['evidence_match'])
        self.assertIn(response['priority']['label'], {'LOW', 'MEDIUM', 'HIGH'})
        self.assertGreaterEqual(response['priority']['score'], 0)
        self.assertLessEqual(response['priority']['score'], 1)

    def test_missing_and_invalid_internal_auth_are_rejected(self):
        missing_status, _ = call_asgi(self.client_app, '/analyze')
        invalid_status, _ = call_asgi(self.client_app, '/analyze', token='wrong-token')
        self.assertEqual(missing_status, 401)
        self.assertEqual(invalid_status, 401)

    def test_non_ascii_internal_auth_is_rejected_cleanly(self):
        status, response = call_asgi(self.client_app, '/analyze', token='é' * 40)
        self.assertEqual(status, 401)
        self.assertNotIn('Traceback', json.dumps(response))

    def test_malformed_image_returns_controlled_4xx(self):
        status, response = call_asgi(
            self.client_app, '/analyze', token=self.TEST_TOKEN,
            image=('bad.png', 'image/png', b'not an image')
        )
        self.assertEqual(status, 400)
        self.assertNotIn('Traceback', json.dumps(response))

    def test_unsupported_image_type_is_rejected(self):
        buffer = io.BytesIO()
        Image.new('RGB', (2, 2)).save(buffer, format='BMP')
        status, _ = call_asgi(
            self.client_app, '/analyze', token=self.TEST_TOKEN,
            image=('report.bmp', 'image/bmp', buffer.getvalue())
        )
        self.assertEqual(status, 415)

    def test_oversized_request_is_rejected_before_parsing(self):
        status, response = call_asgi(
            self.client_app, '/analyze', token=self.TEST_TOKEN,
            raw_body=b'', content_length=MAX_REQUEST_BYTES + 1
        )
        self.assertEqual(status, 413)
        self.assertIn('size limit', response['detail'])

    def test_oversized_image_input_is_rejected(self):
        status, _ = call_asgi(
            self.client_app, '/analyze', token=self.TEST_TOKEN,
            image=('large.png', 'image/png', b'x' * (MAX_IMAGE_BYTES + 1))
        )
        self.assertEqual(status, 413)

    def test_invalid_category_and_coordinates_are_rejected(self):
        invalid_inputs = [
            {'category':'NOT_A_CATEGORY', 'lat':'', 'lng':''},
            {'category':'POTHOLE', 'lat':'91', 'lng':'10'},
            {'category':'POTHOLE', 'lat':'10', 'lng':''}
        ]
        for fields in invalid_inputs:
            fields.update({'text':'', 'existing_complaints':'[]'})
            _, body = multipart(fields)
            status, _ = call_asgi(self.client_app, '/analyze', token=self.TEST_TOKEN, raw_body=body)
            self.assertEqual(status, 400)

    def test_model_failure_returns_sanitized_fallback(self):
        with patch.object(vision_app, 'lazy_models', side_effect=RuntimeError('/private/model/path secret')):
            status, response = call_asgi(self.client_app, '/analyze', token=self.TEST_TOKEN)
        self.assertEqual(status, 200)
        self.assertFalse(response['available'])
        self.assertEqual(response['error'], 'AI analysis is temporarily unavailable.')
        self.assertNotIn('/private/model/path', json.dumps(response))


if __name__ == '__main__':
    unittest.main()
