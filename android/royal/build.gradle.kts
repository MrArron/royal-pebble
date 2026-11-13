import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// The Royal Caribbean client and the cruise store, ported from src/pkjs/royal.js
// (tools/cruise-sync/cruise_sync.py is the reference for every request). Plain
// Kotlin with no Android dependencies, so `./gradlew :royal:test` runs offline
// on any JVM against the shared fixtures in test/fixtures/.
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

dependencies {
    // Only the JsonElement tree is used (no serialization plugin): bundles stay
    // plain JSON, as the JS packer and the watch protocol expect.
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    // The same made-up replies and expected outputs that test/pkjs/royal.test.js
    // and tools/cruise-sync/test_cruise_sync.py use, so the three can't drift.
    systemProperty("fixtures", projectDir.resolve("../../test/fixtures").absolutePath)
}
