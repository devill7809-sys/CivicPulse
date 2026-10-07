import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {signInWithEmailAndPassword,onAuthStateChanged,User} from 'firebase/auth';
import {collection,limit,onSnapshot,orderBy,query} from 'firebase/firestore';
import {adminAuth,firestore} from './firebase';
import {subscribeToAdminComplaints} from './complaint-listener.js';

type Complaint={id:string;category:string;description:string;status:string;priority:string;address?:string;createdAt:string;location?:{lat:number,lng:number};ai?:any;evidence?:{storagePath:string;originalName:string;contentType:string;size:number}|null};
const API=import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '');
if(!API)throw new Error('VITE_API_BASE_URL is required outside development.');
function Login(){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [msg,setMsg]=useState('');return <div className="login"><h1>CivicPulse Admin</h1><input placeholder="Admin email" value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)}/><button onClick={()=>signInWithEmailAndPassword(adminAuth,email,password).catch(e=>setMsg(e.message))}>Sign in</button><p>{msg}</p></div>}
function App(){
 const [user,setUser]=useState<User|null>(null); useEffect(()=>onAuthStateChanged(adminAuth,setUser),[]);
 const [items,setItems]=useState<Complaint[]>([]); const [selected,setSelected]=useState<Complaint|null>(null); const [filter,setFilter]=useState('ALL'); const [error,setError]=useState(''); const [evidenceUrl,setEvidenceUrl]=useState(''); const [loading,setLoading]=useState(true);
 const userId=user?.uid;
 useEffect(()=>{
   if(!userId){setItems([]);setSelected(null);setEvidenceUrl('');setLoading(false);return;}
  const activeUser=adminAuth.currentUser;
   if(!activeUser||activeUser.uid!==userId){setItems([]);setSelected(null);setEvidenceUrl('');setLoading(false);return;}
   let active=true;let unsubscribe=()=>{};setItems([]);setSelected(null);setEvidenceUrl('');setLoading(true);setError('');
  const stop=async()=>{
   try{
	const stopListening=await subscribeToAdminComplaints({
	 user:activeUser,
	 db:firestore,
	 firestoreApi:{collection,limit,onSnapshot,orderBy,query},
	 isActive:()=>active,
	 onComplaints:complaints=>{if(active){setItems(complaints);setSelected(current=>current?complaints.find(complaint=>complaint.id===current.id)??null:null);setError('');setLoading(false)}},
   onError:listenerError=>{if(active){setItems([]);setSelected(null);setEvidenceUrl('');setError(listenerError?.code==='permission-denied'?'Admin access required. Your Firebase account is not authorized for this dashboard.':'Unable to load complaints. Check your admin access and Firebase configuration.');setLoading(false)}}
	});
	if(active)unsubscribe=stopListening;else stopListening();
   }catch{if(active){setItems([]);setSelected(null);setEvidenceUrl('');setError('Unable to load complaints. Check your admin access and Firebase configuration.');setLoading(false)}}
  };
  stop();
  return()=>{active=false;unsubscribe()};
 },[userId]);
 const filtered=useMemo(()=>filter==='ALL'?items:items.filter(x=>x.status===filter),[items,filter]);
 const update=async(status:string)=>{if(!selected||!user)return; try{const token=await user.getIdToken(); const r=await fetch(`${API}/complaints/${selected.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({status})}); if(r.status===403){setError('Admin access required. Your Firebase account is not authorized to update complaint status.'); return;} if(!r.ok){ throw new Error('Status update failed');} setError('');}catch{ setError('Unable to update complaint status.'); }};
 if(!user)return <Login/>;
 return <div className="shell"><aside><h1>CivicPulse</h1><p>Admin Intelligence</p><nav><button onClick={()=>setFilter('ALL')}>All Complaints</button><button onClick={()=>setFilter('PENDING')}>Pending</button><button onClick={()=>setFilter('IN_PROGRESS')}>In Progress</button><button onClick={()=>setFilter('RESOLVED')}>Resolved</button></nav></aside><main><header><div><h2>Complaint Command Center</h2><span>AI-assisted civic operations</span></div><div className="stats"><b>{items.length}</b><small>Total</small></div><div className="stats"><b>{items.filter(x=>x.priority==='HIGH').length}</b><small>High Priority</small></div></header>{error && <div className="error-banner">{error}</div>}<section className="grid"><div className="table">{loading&&<p>Loading complaints...</p>}{!loading&&!error&&filtered.length===0&&<p>No complaints match this filter.</p>}{filtered.map(c=><article key={c.id} onClick={()=>{setSelected(c);setEvidenceUrl('')}}><div><b>{c.id}</b><span>{c.category.replaceAll('_',' ')}</span></div><p>{c.description}</p><div className="meta"><span>{c.status}</span><strong>{c.priority} priority</strong></div></article>)}</div>{selected&&<div className="detail"><button className="close" onClick={()=>{setSelected(null);setEvidenceUrl('')}}>×</button><h3>{selected.id}</h3><p>{selected.description}</p><hr/><p><b>Category:</b> {selected.category}</p><p><b>Location:</b> {selected.address||`${selected.location?.lat}, ${selected.location?.lng}`}</p>{selected.evidence&&<p><button onClick={async()=>{try{const token=await user.getIdToken();const response=await fetch(`${API}/complaints/${encodeURIComponent(selected.id)}/evidence`,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new Error();const result:{url:string}=await response.json();setEvidenceUrl(result.url)}catch{setError('Unable to load complaint evidence.')}}</button>{evidenceUrl&&<> <a href={evidenceUrl} target="_blank" rel="noreferrer">View evidence</a></>}</p>}<h4>AI Analysis</h4><pre>{JSON.stringify(selected.ai||{},null,2)}</pre><div className="actions"><button onClick={()=>update('IN_PROGRESS')}>Start Work</button><button onClick={()=>update('RESOLVED')}>Resolve</button><button onClick={()=>update('REJECTED')}>Reject</button></div></div>}</section></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
