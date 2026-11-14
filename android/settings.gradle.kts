pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "RoyalPriceCheck"
include(":app")
// Royal client and cruise store: plain Kotlin (no Android), so its tests run on any JVM.
include(":royal")
// Serves the watch: src/pkjs/index.js in QuickJS (plain Kotlin, like :royal).
include(":watch")
