import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import {signInWithEmailAndPassword,onAuthStateChanged,User} from 'firebase/auth';
import {adminAuth} from './firebase';

type Complaint={id:string;category:string;description:string;status:string;priority:string;address?:string;createdAt:string;location?:{lat:number,lng:number};ai?:any};
const API='http://localhost:5000/api';
function Login(){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [msg,setMsg]=useState('');return <div className="login"><h1>CivicPulse Admin</h1><input placeholder="Admin email" value={email} onChange={e=>setEmail(e.target.value)}/><input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)}/><button onClick={()=>signInWithEmailAndPassword(adminAuth,email,password).catch(e=>setMsg(e.message))}>Sign in</button><p>{msg}</p></div>}
function App(){
 const [user,setUser]=useState<User|null>(null); useEffect(()=>onAuthStateChanged(adminAuth,setUser),[]); if(!user)return <Login/>;
 const [items,setItems]=useState<Complaint[]>([]); const [selected,setSelected]=useState<Complaint|null>(null); const [filter,setFilter]=useState('ALL');
 const load=async()=>{try{localStorage.setItem('idToken',await user.getIdToken());const r=await fetch(`${API}/complaints`,{headers:{Authorization:`Bearer ${localStorage.getItem('idToken')||''}`}}); if(r.ok)setItems(await r.json())}catch{}};
 useEffect(()=>{load(); const t=setInterval(load,5000); return()=>clearInterval(t)},[]);
 const filtered=useMemo(()=>filter==='ALL'?items:items.filter(x=>x.status===filter),[items,filter]);
 const update=async(status:string)=>{if(!selected)return; await fetch(`${API}/complaints/${selected.id}/status`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('idToken')||''}`},body:JSON.stringify({status})}); setSelected({...selected,status}); load()};
 return <div className="shell"><aside><h1>CivicPulse</h1><p>Admin Intelligence</p><nav><button onClick={()=>setFilter('ALL')}>All Complaints</button><button onClick={()=>setFilter('PENDING')}>Pending</button><button onClick={()=>setFilter('IN_PROGRESS')}>In Progress</button><button onClick={()=>setFilter('RESOLVED')}>Resolved</button></nav></aside><main><header><div><h2>Complaint Command Center</h2><span>AI-assisted civic operations</span></div><div className="stats"><b>{items.length}</b><small>Total</small></div><div className="stats"><b>{items.filter(x=>x.priority==='HIGH').length}</b><small>High Priority</small></div></header><section className="grid"><div className="table">{filtered.map(c=><article key={c.id} onClick={()=>setSelected(c)}><div><b>{c.id}</b><span>{c.category.replaceAll('_',' ')}</span></div><p>{c.description}</p><div className="meta"><span>{c.status}</span><strong>{c.priority} priority</strong></div></article>)}</div>{selected&&<div className="detail"><button className="close" onClick={()=>setSelected(null)}>×</button><h3>{selected.id}</h3><p>{selected.description}</p><hr/><p><b>Category:</b> {selected.category}</p><p><b>Location:</b> {selected.address||`${selected.location?.lat}, ${selected.location?.lng}`}</p><h4>AI Analysis</h4><pre>{JSON.stringify(selected.ai||{},null,2)}</pre><div className="actions"><button onClick={()=>update('IN_PROGRESS')}>Start Work</button><button onClick={()=>update('RESOLVED')}>Resolve</button><button onClick={()=>update('REJECTED')}>Reject</button></div></div>}</section></main></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
