from fastapi import FastAPI, UploadFile, File, Form
from PIL import Image
import io, json, math, re
import numpy as np

app=FastAPI(title='CivicPulse AI Service', version='1.0')

CATEGORIES=['pothole','garbage','streetlight','water leakage','drainage','damaged road','other']
CLIP_LABELS=[
 'a photo of a pothole or road hole',
 'a photo of garbage or unmanaged waste',
 'a photo of a broken streetlight',
 'a photo of water leakage or flooding',
 'a photo of blocked drainage',
 'a photo of a damaged road',
 'a photo of another civic issue'
]

_clip=None
_text_model=None

def lazy_models():
    global _clip,_text_model
    if _clip is None:
        from transformers import CLIPProcessor, CLIPModel
        _clip=(CLIPModel.from_pretrained('openai/clip-vit-base-patch32'), CLIPProcessor.from_pretrained('openai/clip-vit-base-patch32'))
    if _text_model is None:
        from sentence_transformers import SentenceTransformer
        _text_model=SentenceTransformer('all-MiniLM-L6-v2')
    return _clip,_text_model

def cosine(a,b):
    a=np.asarray(a); b=np.asarray(b)
    den=np.linalg.norm(a)*np.linalg.norm(b)
    return float(np.dot(a,b)/den) if den else 0.0

def geo_distance_m(a,b):
    R=6371000
    p1,p2=math.radians(a['lat']),math.radians(b['lat'])
    dp=math.radians(b['lat']-a['lat']); dl=math.radians(b['lng']-a['lng'])
    x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def severity_from_text(text):
    t=text.lower()
    high=['danger','accident','injury','blocked','flood','severe','major','urgent','school','hospital']
    medium=['large','deep','heavy','frequent','traffic','unsafe','leak']
    h=sum(1 for x in high if x in t); m=sum(1 for x in medium if x in t)
    if h>=2: return 'HIGH',0.9
    if h or m>=2: return 'MEDIUM',0.65
    return 'LOW',0.4

@app.get('/health')
def health(): return {'ok':True,'service':'civicpulse-ai'}

@app.post('/analyze')
async def analyze(image: UploadFile|None=File(None), text:str=Form(''), category:str=Form(''), lat:str=Form(''), lng:str=Form(''), existing_complaints:str=Form('[]')):
    image_bytes=await image.read() if image else None
    requested=category.lower().replace('_',' ')
    severity_label,severity_score=severity_from_text(text)
    result={'available':True,'model':'CLIP + sentence-transformers','classification':None,'nlp':{'severity':severity_label},'evidence_match':None,'duplicates':[],'priority':None}

    try:
        clip,text_model=lazy_models()
        if image_bytes:
            model,processor=clip
            im=Image.open(io.BytesIO(image_bytes)).convert('RGB')
            inputs=processor(text=CLIP_LABELS,images=im,return_tensors='pt',padding=True)
            out=model(**inputs)
            probs=out.logits_per_image.softmax(dim=1)[0].detach().cpu().numpy()
            idx=int(np.argmax(probs))
            predicted=CATEGORIES[idx]
            conf=float(probs[idx])
            result['classification']={'label':predicted,'confidence':round(conf,3)}
            result['evidence_match']={'match': predicted==requested or (requested=='damaged road' and predicted=='pothole'), 'predicted':predicted, 'requested':requested}
        emb=text_model.encode(text or requested,normalize_embeddings=True)
        complaints=json.loads(existing_complaints or '[]')
        latn=float(lat) if lat else None; lngn=float(lng) if lng else None
        for c in complaints:
            desc=c.get('description','')
            if not desc: continue
            cemb=text_model.encode(desc,normalize_embeddings=True)
            sim=cosine(emb,cemb)
            dist=None
            loc=c.get('location') or {}
            if latn is not None and 'lat' in loc and 'lng' in loc:
                dist=geo_distance_m({'lat':latn,'lng':lngn},{'lat':loc['lat'],'lng':loc['lng']})
            if sim>=0.82 and (dist is None or dist<=100):
                result['duplicates'].append({'complaintId':c.get('id'),'textSimilarity':round(sim,3),'distanceMeters':round(dist,1) if dist is not None else None})
        duplicate_factor=min(1,len(result['duplicates'])/3)
        priority_score=0.55*severity_score+0.25*duplicate_factor+0.20*(1 if result.get('evidence_match',{}).get('match',True) else 0)
        label='HIGH' if priority_score>=0.7 else 'MEDIUM' if priority_score>=0.45 else 'LOW'
        result['priority']={'label':label,'score':round(priority_score,3)}
    except Exception as e:
        result['available']=False
        result['error']=str(e)
        result['priority']={'label':'MEDIUM','score':0.5}
    return result
