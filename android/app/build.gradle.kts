import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.chaquo.python")
}

// Release signing comes from environment variables (GitHub Actions secrets). Without them the
// build falls back to the committed ci-debug.jks so every CI build has the SAME signature and
// installs as an update over the previous one.
val signingEnv = System.getenv()
val hasReleaseKey = !signingEnv["SIGNING_KEYSTORE_PATH"].isNullOrBlank()

val upstreamVersion = rootProject.file("app/src/main/python/upstream/UPSTREAM_VERSION")
    .takeIf { it.exists() }?.readText()?.trim() ?: "unknown"

android {
    namespace = "io.github.mrarron.royalpricecheck"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.mrarron.royalpricecheck"
        minSdk = 26
        targetSdk = 35
        versionCode = (signingEnv["VERSION_CODE"] ?: "1").toInt()
        versionName = signingEnv["VERSION_NAME"] ?: "0.1.0"
        buildConfigField("String", "UPSTREAM_VERSION", "\"${upstreamVersion.replace("\"", "")}\"")
        ndk {
            // Real phones only (arm64). Add "x86_64" here to run on the Android emulator.
            abiFilters += listOf("arm64-v8a")
        }
    }

    signingConfigs {
        create("shared") {
            if (hasReleaseKey) {
                storeFile = file(signingEnv["SIGNING_KEYSTORE_PATH"]!!)
                storePassword = signingEnv["SIGNING_STORE_PASSWORD"]
                keyAlias = signingEnv["SIGNING_KEY_ALIAS"]
                keyPassword = signingEnv["SIGNING_KEY_PASSWORD"]
            } else {
                storeFile = rootProject.file("ci-debug.jks")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        getByName("debug") {
            signingConfig = signingConfigs.getByName("shared")
        }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

chaquopy {
    defaultConfig {
        version = "3.12"
        pip {
            // Same requirements as upstream requirements.txt, minus curl_cffi (native, optional:
            // the script falls back to plain requests when it is missing).
            install("requests")
            install("PyYAML")
            install("apprise")
        }
        // Keep .py sources so tracebacks in the log show real line numbers.
        pyc {
            src = false
        }
    }
}

dependencies {
    implementation(project(":royal"))
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
}
