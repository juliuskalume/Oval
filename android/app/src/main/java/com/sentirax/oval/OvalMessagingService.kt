package com.sentirax.oval

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class OvalMessagingService : FirebaseMessagingService() {

  companion object {
    private const val channelId = "oval-updates"
    private const val prefsName = "oval_push_prefs"
    private const val prefPushToken = "push_token"

    fun storedPushToken(context: Context): String {
      return context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        .getString(prefPushToken, "")
        .orEmpty()
    }
  }

  override fun onNewToken(token: String) {
    super.onNewToken(token)
    applicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
      .edit()
      .putString(prefPushToken, token)
      .apply()
  }

  override fun onMessageReceived(message: RemoteMessage) {
    super.onMessageReceived(message)
    if (MainActivity.appVisible) {
      return
    }

    val data = message.data
    val title = data["title"].orEmpty().ifBlank { "Oval" }
    val body = data["body"].orEmpty().ifBlank { "You have a new Oval update." }
    val targetUrl = data["targetUrl"].orEmpty().ifBlank { "https://oval-nine.vercel.app/inbox.html" }
    showNotification(title, body, targetUrl, data["notificationId"].orEmpty())
  }

  private fun showNotification(title: String, body: String, targetUrl: String, notificationId: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
      && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return
    }

    createNotificationChannel()

    val intent = Intent(this, MainActivity::class.java).apply {
      data = Uri.parse(targetUrl)
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      (notificationId.hashCode().takeIf { it != 0 } ?: title.hashCode()),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(this, channelId)
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    NotificationManagerCompat.from(this).notify(
      notificationId.hashCode().takeIf { it != 0 } ?: System.currentTimeMillis().toInt(),
      notification,
    )
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(channelId) != null) {
      return
    }

    val channel = NotificationChannel(
      channelId,
      getString(R.string.notifications_channel_name),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = getString(R.string.notifications_channel_description)
    }
    manager.createNotificationChannel(channel)
  }
}
