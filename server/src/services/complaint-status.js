const ALLOWED_STATUSES = new Set(['PENDING','IN_PROGRESS','RESOLVED','REJECTED']);

export function createComplaintStatusHandler({db, notifyStatus, logger = console}) {
  return async (req, res) => {
    if (!req.user?.uid) return res.status(401).json({error:'Authentication required'});
    if (req.user.admin !== true) return res.status(403).json({error:'Admin access required'});
    if (!db) return res.status(503).json({error:'Firestore is not configured'});

    const {status, resolutionNote = ''} = req.body || {};
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({error:'Invalid status'});

    try {
      const complaintRef = db.collection('complaints').doc(req.params.id);
      const snapshot = await complaintRef.get();
      if (!snapshot.exists) return res.status(404).json({error:'Complaint not found'});

      await complaintRef.update({status, resolutionNote, updatedAt:new Date().toISOString()});
      try {
        await notifyStatus?.({complaintId:req.params.id, status});
      } catch (error) {
        logger.warn('Complaint status notification failed', {code:error?.code});
      }
      return res.json({ok:true});
    } catch (error) {
      logger.error('Complaint status update failed', {code:error?.code});
      return res.status(500).json({error:'Complaint status update failed'});
    }
  };
}