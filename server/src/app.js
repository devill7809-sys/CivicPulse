import express from 'express';
import cors from 'cors';
import complaints from './routes/complaints.js';
import notifications from './routes/notifications.js';
import 'dotenv/config';

const app = express();
app.use(cors({origin:process.env.CLIENT_ORIGIN || true}));
app.use(express.json({limit:'2mb'}));
app.get('/health',(req,res)=>res.json({ok:true,service:'civicpulse-api'}));
app.use('/api/notifications',notifications);
app.use('/api/complaints',complaints);
export default app;
