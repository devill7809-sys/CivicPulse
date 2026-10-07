import express from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { db } from '../firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { analyzeComplaint } from '../services/ai.js';

const router = express.Router();
const uploadDir = path.resolve('uploads');
fs.mkdirSync(uploadDir, {recursive:true});
const upload = multer({dest: uploadDir, limits:{fileSize:25*1024*1024}});

const allowedCategories = ['POTHOLE','GARBAGE','STREETLIGHT','WATER_LEAKAGE','DRAINAGE','DAMAGED_ROAD','OTHER'];

router.post('/', requireAuth, upload.single('evidence'), async (req,res)=>{
  if (!db) return res.status(503).json({error:'Firestore is not configured'});
  const {description='', category='', lat, lng, address=''} = req.body;
  if (!description || !category || lat === undefined || lng === undefined) return res.status(400).json({error:'description, category and location are required'});
  if (!allowedCategories.includes(category)) return res.status(400).json({error:'Unsupported category'});

  const snapshot = await db.collection('complaints').limit(300).get();
  const existing = snapshot.docs.map(d=>({id:d.id,...d.data()}));
  let ai = {available:false};
  try {
    ai = await analyzeComplaint({imagePath:req.file?.path,text:description,category,lat:Number(lat),lng:Number(lng),existingComplaints:existing});
  } catch (e) {
    console.warn('AI unavailable:', e.message);
    ai = {available:false, error:e.message};
  }

  const id = `CP-${uuid().slice(0,8).toUpperCase()}`;
  const doc = {
    id, citizenId:req.user.uid, description, category, address,
    location:{lat:Number(lat),lng:Number(lng)},
    evidence:{filename:req.file?.originalname || null},
    ai,
    status:'PENDING',
    priority: ai.priority?.label || 'MEDIUM',
    createdAt: new Date().toISOString(), updatedAt:new Date().toISOString()
  };
  await db.collection('complaints').doc(id).set(doc);
  if (req.file) fs.unlink(req.file.path,()=>{});
  res.status(201).json(doc);
});

router.get('/mine', requireAuth, async (req,res)=>{
  const snap = await db.collection('complaints').where('citizenId','==',req.user.uid).get();
  res.json(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});

router.get('/', requireAuth, async (req,res)=>{
  const snap = await db.collection('complaints').limit(500).get();
  res.json(snap.docs.map(d=>d.data()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
});

router.patch('/:id/status', requireAuth, async (req,res)=>{
  const {status, resolutionNote=''} = req.body;
  if (!['PENDING','IN_PROGRESS','RESOLVED','REJECTED'].includes(status)) return res.status(400).json({error:'Invalid status'});
  await db.collection('complaints').doc(req.params.id).update({status,resolutionNote,updatedAt:new Date().toISOString()});
  res.json({ok:true});
});

export default router;
