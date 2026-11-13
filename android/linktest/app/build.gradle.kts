plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.mrarron.royalpebble.linktest"
    compileSdk = 37

    defaultConfig {
        // Must match the "companionApp" package in the watch app's package.json,
        // or the Pebble app won't let this app send to Royal Pebble.
        applicationId = "io.github.mrarron.royalpebble.linktest"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("io.rebble.pebblekit2:client:1.3.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")
}
