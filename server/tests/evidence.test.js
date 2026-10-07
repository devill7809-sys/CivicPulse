import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_SIZE_BYTES,
  buildEvidenceStoragePath,
  normalizeEvidenceFile,
  canAccessComplaintEvidence
} from '../src/services/evidence.js';

const validPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082', 'hex');

test('authenticated citizen can submit valid image evidence', () => {
  const file = {
    buffer: validPng,
    size: validPng.length,
    mimetype: 'image/png',
    originalname: 'complaint.png'
  };

  const normalized = normalizeEvidenceFile(file);
  assert.equal(normalized.contentType, 'image/png');
  assert.equal(normalized.size, validPng.length);
  assert.ok(ALLOWED_EVIDENCE_TYPES.has(normalized.contentType));
});

test('invalid file type is rejected', () => {
  const file = {
    buffer: validPng,
    size: validPng.length,
    mimetype: 'image/svg+xml',
    originalname: 'note.svg'
  };

  assert.throws(() => normalizeEvidenceFile(file), /Unsupported evidence file type/);
});

test('fake content with an image MIME type is rejected', () => {
  const buffer = Buffer.from('not an image');
  assert.throws(() => normalizeEvidenceFile({buffer, size:buffer.length, mimetype:'image/png', originalname:'fake.png'}), /Invalid evidence file/);
});

test('mismatched image extension is rejected', () => {
  assert.throws(() => normalizeEvidenceFile({buffer:validPng, size:validPng.length, mimetype:'image/png', originalname:'image.jpg'}), /Invalid evidence file/);
});

test('oversized file is rejected', () => {
  const file = {
    buffer: Buffer.alloc(MAX_EVIDENCE_SIZE_BYTES + 1),
    size: MAX_EVIDENCE_SIZE_BYTES + 1,
    mimetype: 'image/jpeg',
    originalname: 'large.jpg'
  };

  assert.throws(() => normalizeEvidenceFile(file), /too large/);
});

test('citizen evidence path is scoped to the user', () => {
  const path = buildEvidenceStoragePath('citizen-123', 'abc.png');
  assert.match(path, /^evidence\/citizen-123\//);
  assert.doesNotMatch(path, /^evidence\/other-user\//);
});

test('filename traversal cannot add Storage path segments', () => {
  const path = buildEvidenceStoragePath('citizen-123', '../../private.png');
  assert.equal(path.split('/').length, 3);
  assert.match(path, /^evidence\/citizen-123\//);
});

test('admin access is allowed according to the existing custom claim', () => {
  assert.equal(canAccessComplaintEvidence({uid:'admin-42', admin:true}, {citizenId:'citizen-1'}), true);
});

test('citizens cannot access another citizen evidence', () => {
  assert.equal(canAccessComplaintEvidence({uid:'citizen-2', admin:false}, {citizenId:'citizen-1'}), false);
});

