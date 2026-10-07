package com.civicpulse

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.await
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

internal object FcmTokenRegistrar {
    private val client = OkHttpClient()

    suspend fun register(context: Context, fcmToken: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val user = FirebaseAuth.getInstance().currentUser ?: return@withContext false
            val idToken = try {
                user.getIdToken(false).await().token
            } catch (error: Exception) {
                Log.w("CivicPulseFCM", "Unable to obtain authenticated token for FCM registration", error)
                return@withContext false
            }
            if (idToken.isNullOrBlank() || fcmToken.isBlank()) return@withContext false

            val body = JSONObject().put("token", fcmToken).toString()
                .toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url("${BuildConfig.API_BASE_URL.trimEnd('/')}/notifications/token")
                .header("Authorization", "Bearer $idToken")
                .post(body)
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) true else {
                    Log.w("CivicPulseFCM", "FCM token registration returned HTTP ${response.code}")
                    false
                }
            }
        } catch (error: Exception) {
            Log.w("CivicPulseFCM", "FCM token registration request failed", error)
            false
        }
    }
}

internal object CivicPulseNotifications {
    const val CHANNEL_ID = "civicpulse_updates"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "CivicPulse Updates",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Updates about your civic complaints"
        }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun show(context: Context, message: RemoteMessage) {
        createChannel(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val complaintId = message.data[CivicPulseMessagingService.EXTRA_COMPLAINT_ID]?.take(64)
        val status = message.data[CivicPulseMessagingService.EXTRA_STATUS]?.take(32)
        val title = (message.notification?.title ?: "CivicPulse update").take(80)
        val body = (message.notification?.body
            ?: if (complaintId != null && status != null) "Complaint $complaintId status is now $status."
            else "A complaint status has been updated.").take(160)
        val intent = Intent(context, MainActivity::class.java).apply {
            action = CivicPulseMessagingService.ACTION_OPEN_COMPLAINT
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (complaintId != null) putExtra(CivicPulseMessagingService.EXTRA_COMPLAINT_ID, complaintId)
            if (status != null) putExtra(CivicPulseMessagingService.EXTRA_STATUS, status)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            ("$complaintId:$status").hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(("$complaintId:$status").hashCode(), notification)
        } catch (error: SecurityException) {
            Log.w("CivicPulseFCM", "Notification permission is unavailable")
        }
    }
}

class CivicPulseMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            FcmTokenRegistrar.register(applicationContext, token)
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        CivicPulseNotifications.show(this, message)
    }

    companion object {
        const val EXTRA_COMPLAINT_ID = "complaintId"
        const val EXTRA_STATUS = "status"
        const val ACTION_OPEN_COMPLAINT = "com.civicpulse.OPEN_COMPLAINT"
    }
}
