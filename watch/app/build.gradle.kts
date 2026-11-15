import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

/** Connection defaults come from the gitignored watch/local.properties; the watch's settings page can override them. */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use(::load)
}

fun localProperty(key: String): String = localProperties.getProperty(key, "")

fun String.asBuildConfigString(): String = "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

/** The Samsung Health Sensor SDK is not redistributable here; each developer drops the .aar into app/libs. */
val samsungSensorSdk = file("libs/samsung-health-sensor-api-1.4.1.aar")
val hasSamsungSensorSdk = samsungSensorSdk.exists()

android {
    namespace = "org.heartbeat.watch"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.heartbeat.watch"
        minSdk = 30 // Wear OS 3+
        targetSdk = 36
        versionCode = 1
        versionName = "0.4.0"

        buildConfigField("String", "DEFAULT_SERVER_URL", localProperty("heartbeat.serverUrl").asBuildConfigString())
        buildConfigField("String", "DEFAULT_TOKEN", localProperty("heartbeat.token").asBuildConfigString())
        buildConfigField("String", "DEFAULT_ASTRONAUT_ID", localProperty("heartbeat.astronautId").asBuildConfigString())
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            kotlin.srcDir(if (hasSamsungSensorSdk) "src/samsung/java" else "src/noSamsung/java")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }
}

dependencies {
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.wear.compose:compose-material3:1.7.1")
    implementation("androidx.health:health-services-client:1.1.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.datastore:datastore-preferences:1.3.0")
    implementation("androidx.wear:wear-input:1.2.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    if (hasSamsungSensorSdk) implementation(files(samsungSensorSdk))

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
