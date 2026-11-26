plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersionName = (System.getenv("APK_VERSION_NAME") ?: "1.0.0").trim().ifEmpty { "1.0.0" }
val appVersionCode = (System.getenv("APK_VERSION_CODE") ?: "100").toIntOrNull() ?: 100

val keystorePath = System.getenv("KEYSTORE_FILE")?.trim().orEmpty()
val keystorePass = System.getenv("KEYSTORE_PASSWORD")?.trim().orEmpty()
val keyAliasEnv = System.getenv("KEY_ALIAS")?.trim().orEmpty()
val keyPass = System.getenv("KEY_PASSWORD")?.trim().orEmpty()
val hasReleaseSigning = keystorePath.isNotEmpty() && keystorePass.isNotEmpty() && keyAliasEnv.isNotEmpty() && keyPass.isNotEmpty() && file(keystorePath).exists()

android {
    namespace = "com.teleport.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.teleport.app"
        minSdk = 24
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystorePass
                keyAlias = keyAliasEnv
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ""
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.zxing:core:3.5.3")
}
