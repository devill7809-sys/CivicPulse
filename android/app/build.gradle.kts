plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("com.google.gms.google-services") }

val apiBaseUrl = providers.gradleProperty("civicpulseApiBaseUrl").orElse("http://10.0.2.2:5000/api")
val escapedApiBaseUrl = apiBaseUrl.get().replace("\\", "\\\\").replace("\"", "\\\"")

android { namespace="com.civicpulse"; compileSdk=35
 defaultConfig { applicationId="com.civicpulse"; minSdk=26; targetSdk=35; versionCode=1; versionName="1.0"; buildConfigField("String","API_BASE_URL","\"$escapedApiBaseUrl\"") }
 buildFeatures { compose=true; buildConfig=true }
}

val verifyReleaseApiBaseUrl by tasks.registering {
	doLast {
		val configuredUrl = providers.gradleProperty("civicpulseApiBaseUrl").orNull
		if (configuredUrl == null || !configuredUrl.startsWith("https://")) {
			throw GradleException("Release builds require -PcivicpulseApiBaseUrl=https://<your-api-host>/api")
		}
	}
}

tasks.matching { it.name == "preReleaseBuild" }.configureEach {
	dependsOn(verifyReleaseApiBaseUrl)
}

dependencies {
 implementation(platform("androidx.compose:compose-bom:2024.12.01"))
 implementation("androidx.activity:activity-compose:1.10.0")
 implementation("androidx.compose.material3:material3")
 implementation("androidx.compose.ui:ui")
 implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
 implementation("androidx.navigation:navigation-compose:2.8.5")
 implementation("com.google.firebase:firebase-auth:23.1.0")
 implementation("com.google.firebase:firebase-firestore:25.1.1")
 implementation("com.google.firebase:firebase-storage:21.0.1")
 implementation("com.google.firebase:firebase-messaging:24.1.0")
 implementation("com.google.android.gms:play-services-location:21.3.0")
 implementation("io.coil-kt:coil-compose:2.7.0")
 implementation("com.squareup.okhttp3:okhttp:4.12.0")
 implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
