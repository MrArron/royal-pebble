// Versions follow PebbleKit Android 2 1.3.2 (the watch link), which needs
// compileSdk 37 and Kotlin 2.4 (as android/linktest). AGP 9 compiles Kotlin
// itself (built-in Kotlin), so the app applies no Kotlin Android plugin.
plugins {
    id("com.android.application") version "9.5.0" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("com.chaquo.python") version "17.2.0" apply false
}
