import express from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { db, storage } from '../firebase.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { analyzeComplaint } from '../services/ai.js';
import { messaging } from '../firebase.js';
import { sendComplaintStatusNotification } from '../services/notifications.js';
import { createComplaintStatusHandler } from '../services/complaint-status.js';
import {
  MAX_EVIDENCE_SIZE_BYTES,
  normalizeEvidenceFile,
  buildEvidenceStoragePath,
  canAccessComplaintEvidence
} from '../services/evidence.js';

const router = express.Router();
const upload = multer({storage: multer.memoryStorage(), limits:{fileSize:MAX_EVIDENCE_SIZE_BYTES}});

const allowedCategories = ['POTHOLE','GARBAGE','STREETLIGHT','WATER_LEAKAGE','DRAINAGE','DAMAGED_ROAD','OTHER'];

router.post('/', requireAuth, upload.single('evidence'), async (req,res)=>{
  if (!db) return res.status(503).json({error:'Firestore is not configured'});
  if (!storage) return res.status(503).json({error:'Firebase Storage is not configured'});

  const {description='', category='', lat, lng, address=''} = req.body;
  if (!description || !category || lat === undefined || lng === undefined) return res.status(400).json({error:'description, category and location are required'});
  if (!allowedCategories.includes(category)) return res.status(400).json({error:'Unsupported category'});

  let tempFilePath = null;
  let storagePath = null;
  let uploadedEvidence = null;
  let complaintCreated = false;

  try {
    if (req.file) {
      const evidence = normalizeEvidenceFile(req.file);
      storagePath = buildEvidenceStoragePath(req.user.uid, evidence.originalName);
      uploadedEvidence = {
        storagePath,
        originalName: evidence.originalName,
        contentType: evidence.contentType,
        size: evidence.size,
        uploadedAt: new Date().toISOString()
      };

      const file = storage.file(storagePath);
      await file.save(evidence.buffer, {
        metadata: { contentType: evidence.contentType, cacheControl: 'private' },
        public: false
      });

      if (evidence.buffer && evidence.buffer.length > 0) {
        const extension = path.extname(evidence.originalName) || '.jpg';
        tempFilePath = path.join(os.tmpdir(), `civicpulse-${uuid()}${extension}`);
        fs.writeFileSync(tempFilePath, evidence.buffer);
      }
    }

    const snapshot = await db.collection('complaints').limit(300).get();
    const existing = snapshot.docs.map(d=>({id:d.id,...d.data()}));
    let ai = {available:false};
    try {
      ai = await analyzeComplaint({imagePath: tempFilePath || undefined, text:description, category, lat:Number(lat), lng:Number(lng), existingComplaints:existing});
    } catch (e) {
      console.warn('AI unavailable:', e.message);
      ai = {available:false, error:e.message};
    }

    const id = `CP-${uuid().slice(0,8).toUpperCase()}`;
    const doc = {
      id, citizenId:req.user.uid, description, category, address,
      location:{lat:Number(lat),lng:Number(lng)},
      evidence: uploadedEvidence ? { ...uploadedEvidence } : null,
      ai,
      status:'PENDING',
      priority: ai.priority?.label || 'MEDIUM',
      createdAt: new Date().toISOString(), updatedAt:new Date().toISOString()
    };

    await db.collection('complaints').doc(id).set(doc);
    complaintCreated = true;
    res.status(201).json(doc);
  } catch (error) {
    if (storagePath && !complaintCreated) {
      try {
        await storage.file(storagePath).delete({ignoreNotFound:true});
      } catch (cleanupError) {
        console.error('Evidence cleanup failed after complaint submission error', {code:cleanupError?.code});
      }
    }
    if (error?.statusCode === 400 || error?.message?.includes('Unsupported') || error?.message?.includes('too large') || error?.message?.includes('Invalid')) {
      return res.status(400).json({error:error.message || 'Invalid evidence upload'});
    }
    console.error('Complaint creation failed:', error);
    return res.status(500).json({error:'Complaint submission failed'});
  } finally {
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
});

router.get('/mine', requireAuth, async (req,res)=>{
  const snap = await db.collection('complaints').where('citizenId','==',req.user.uid).get();
  res.json(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});

router.get('/:id/evidence', requireAuth, async (req,res)=>{
  if (!db || !storage) return res.status(503).json({error:'Evidence storage is not configured'});

  try {
    const snapshot = await db.collection('complaints').doc(req.params.id).get();
    if (!snapshot.exists) return res.status(404).json({error:'Complaint or evidence not found'});

    const complaint = snapshot.data();
    if (!canAccessComplaintEvidence(req.user, complaint)) return res.status(403).json({error:'Evidence access denied'});
    const storagePath = complaint.evidence?.storagePath;
    if (!storagePath || !storagePath.startsWith(`evidence/${complaint.citizenId}/`)) {
      return res.status(404).json({error:'Complaint or evidence not found'});
    }

    const evidenceFile = storage.file(storagePath);
    const [exists] = await evidenceFile.exists();
    if (!exists) return res.status(404).json({error:'Complaint or evidence not found'});

    const expiresAt = Date.now() + 5 * 60 * 1000;
    const [url] = await evidenceFile.getSignedUrl({action:'read', expires:expiresAt});
    return res.json({url, expiresAt, contentType:complaint.evidence.contentType, originalName:complaint.evidence.originalName});
  } catch (error) {
    console.error('Evidence access failed', {code:error?.code});
    return res.status(500).json({error:'Unable to retrieve evidence'});
  }
});

router.get('/', requireAuth, requireAdmin, async (req,res)=>{
  const snap = await db.collection('complaints').limit(500).get();
  res.json(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});

router.patch('/:id/status', requireAuth, requireAdmin, createComplaintStatusHandler({
  db,
  notifyStatus: ({complaintId, status}) => sendComplaintStatusNotification({db, messaging, complaintId, status})
}));

export default router;
