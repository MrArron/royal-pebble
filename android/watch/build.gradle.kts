import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Serves the watch from the Android app by running the phone companion itself
// (src/pkjs/index.js) in QuickJS. Plain Kotlin with no Android dependencies:
// the engine is behind JsRuntime, so `./gradlew :watch:test` runs on any JVM
// with Zipline's desktop QuickJS, and compares whole sessions with Node.
plugins {
    id("org.jetbrains.kotlin.jvm")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// src/pkjs and package.json (for the message keys) ship in the app as Java
// resources, so the app and PebbleKit JS run one copy of the code.
val pkjs = tasks.register<Sync>("pkjsResources") {
    from(projectDir.resolve("../../src/pkjs")) {
        include("**/*.js")
        into("royalpebble/pkjs")
    }
    from(projectDir.resolve("../../package.json")) {
        into("royalpebble")
    }
    into(layout.buildDirectory.dir("generated/pkjs"))
}

sourceSets {
    main {
        resources.srcDir(pkjs)
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.11.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    // QuickJS for the desktop JVM: the same engine the app gets from zipline-android.
    // (androidx.annotation is only annotations, and comes from Google's Maven.)
    testImplementation("app.cash.zipline:zipline-jvm:1.28.0") {
        exclude(group = "androidx.annotation")
    }
}

tasks.test {
    val repo = projectDir.resolve("../..").canonicalFile
    systemProperty("repo", repo.absolutePath)
    // A zone with daylight saving time, so local-time code is exercised in
    // QuickJS (the C library's localtime) and in Node alike.
    environment("TZ", "America/New_York")
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
