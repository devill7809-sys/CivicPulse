package com.civicpulse

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

private val categories=listOf("POTHOLE","GARBAGE","STREETLIGHT","WATER_LEAKAGE","DRAINAGE","DAMAGED_ROAD","OTHER")
private val client=OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(60,TimeUnit.SECONDS).build()

class MainActivity:ComponentActivity(){ override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState);setContent{CivicPulseApp(this)}} }

@Composable fun CivicPulseApp(context:Context){
 var screen by remember{mutableStateOf("home")}; val auth=remember{FirebaseAuth.getInstance()}
 if(auth.currentUser==null){ LoginScreen(auth); return }
 MaterialTheme{ Surface(Modifier.fillMaxSize()){ when(screen){"home"->Home({screen="report"},{screen="track"});"report"->Report(context,auth){screen="home"};"track"->Track(auth){screen="home"} } } }
}

@Composable fun LoginScreen(auth:FirebaseAuth){
 var email by remember{mutableStateOf("")};var pass by remember{mutableStateOf("")};var signup by remember{mutableStateOf(false)};var msg by remember{mutableStateOf("")}
 Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("CivicPulse",style=MaterialTheme.typography.headlineLarge);Text("Citizen Portal")
  OutlinedTextField(email,{email=it},label={Text("Email")},modifier=Modifier.fillMaxWidth());OutlinedTextField(pass,{pass=it},label={Text("Password")},modifier=Modifier.fillMaxWidth())
  Button(onClick={authTask(auth,email,pass,signup){msg=it}},Modifier.fillMaxWidth()){Text(if(signup)"Create account" else "Sign in")}
  TextButton(onClick={signup=!signup}){Text(if(signup)"Already have an account? Sign in" else "Create a citizen account")}; if(msg.isNotEmpty())Text(msg)
 }
}
fun authTask(auth:FirebaseAuth,email:String,pass:String,signup:Boolean,done:(String)->Unit){ if(email.isBlank()||pass.length<6){done("Enter a valid email and 6+ character password");return}; if(signup) auth.createUserWithEmailAndPassword(email,pass).addOnSuccessListener{done("")}.addOnFailureListener{done(it.message?:"Signup failed")} else auth.signInWithEmailAndPassword(email,pass).addOnSuccessListener{done("")}.addOnFailureListener{done(it.message?:"Login failed")} }

@Composable fun Home(report:()->Unit,track:()->Unit){Column(Modifier.padding(22.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){Text("CivicPulse",style=MaterialTheme.typography.headlineLarge);Text("Report. Resolve. Improve.");Button(report,Modifier.fillMaxWidth()){Text("Report a Civic Issue")};OutlinedButton(track,Modifier.fillMaxWidth()){Text("Track My Complaints")};Text("Potholes • Garbage • Streetlights • Water • Drainage")}}

@Composable fun Report(context:Context,auth:FirebaseAuth,done:()->Unit){
 var description by remember{mutableStateOf("")};var category by remember{mutableStateOf(categories[0])};var lat by remember{mutableStateOf("")};var lng by remember{mutableStateOf("")};var address by remember{mutableStateOf("")};var msg by remember{mutableStateOf("")};var imageUri by remember{mutableStateOf<Uri?>(null)};var sending by remember{mutableStateOf(false)};val scope=rememberCoroutineScope()
 val picker=rememberLauncherForActivityResult(ActivityResultContracts.GetContent()){imageUri=it}
 val locationPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){r->if(r.values.any{it})getLocation(context){a,b->lat=a.toString();lng=b.toString()}}
 Column(Modifier.padding(22.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
  Text("Report Issue",style=MaterialTheme.typography.headlineMedium);OutlinedTextField(description,{description=it},label={Text("Describe the issue")},modifier=Modifier.fillMaxWidth());Text("Category")
  LazyColumn(Modifier.height(110.dp)){items(categories){c->FilterChip(selected=c==category,onClick={category=c},label={Text(c.replace('_',' '))})}}
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={picker.launch("image/*")}){Text(if(imageUri==null)"Add photo" else "Photo selected")};Button(onClick={locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))}){Text("Get GPS")}}
  Text("Location: ${if(lat.isBlank())"Not captured" else "$lat, $lng"}")
  Button(enabled=!sending,onClick={scope.launch{sending=true;msg=submitComplaint(context,auth,description,category,lat,lng,address,imageUri);sending=false}},Modifier.fillMaxWidth()){Text(if(sending)"Analysing…" else "Submit Complaint")}
  if(msg.isNotEmpty())Text(msg);TextButton(done){Text("Back")}
 }
}
fun getLocation(context:Context,done:(Double,Double)->Unit){val c=LocationServices.getFusedLocationProviderClient(context);if(ContextCompat.checkSelfPermission(context,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||ContextCompat.checkSelfPermission(context,Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED)c.lastLocation.addOnSuccessListener{if(it!=null)done(it.latitude,it.longitude)}}

suspend fun submitComplaint(context:Context,auth:FirebaseAuth,description:String,category:String,lat:String,lng:String,address:String,uri:Uri?):String=withContext(Dispatchers.IO){
 if(description.isBlank()||lat.isBlank()||lng.isBlank())return@withContext "Description and GPS location are required."
 try{val token=auth.currentUser?.getIdToken(false)?.await()?.token?:return@withContext "Authentication token unavailable";val body=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("description",description).addFormDataPart("category",category).addFormDataPart("lat",lat).addFormDataPart("lng",lng).addFormDataPart("address",address)
  if(uri!=null){val file=File.createTempFile("evidence",".jpg",context.cacheDir);context.contentResolver.openInputStream(uri)!!.use{input->file.outputStream().use{input.copyTo(it)}};body.addFormDataPart("evidence",file.name,file.asRequestBody("image/*".toMediaType()))}
  val req=Request.Builder().url(BuildConfig.API_BASE_URL+"/complaints").addHeader("Authorization","Bearer $token").post(body.build()).build();client.newCall(req).execute().use{r->val txt=r.body?.string().orEmpty();if(!r.isSuccessful)"Submission failed: $txt" else "Complaint submitted successfully. AI analysis and admin review have started."}
 }catch(e:Exception){"Submission error: ${e.message}"}
}

@Composable fun Track(auth:FirebaseAuth,back:()->Unit){var items by remember{mutableStateOf(listOf<Map<String,Any>>())};LaunchedEffect(Unit){FirebaseFirestore.getInstance().collection("complaints").whereEqualTo("citizenId",auth.currentUser?.uid).addSnapshotListener{snap,_->items=snap?.documents?.map{it.data?:emptyMap()}?:emptyList()}};Column(Modifier.padding(22.dp)){Text("My Complaints",style=MaterialTheme.typography.headlineMedium);LazyColumn{items(items){m->Text("${m["id"]} • ${m["status"]} • ${m["priority"]}",Modifier.padding(vertical=10.dp))}};TextButton(back){Text("Back")}}}
