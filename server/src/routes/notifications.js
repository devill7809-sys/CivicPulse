import express from 'express';
import { db } from '../firebase.js';
import { requireAuth } from '../middleware/auth.js';
import { createTokenRegistrationHandler } from '../services/notifications.js';

const router = express.Router();

router.post('/token', requireAuth, createTokenRegistrationHandler({db}));

export default router;