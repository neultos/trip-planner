plugins { id("com.android.application") }
android {
    namespace = "io.github.neultos.wetrip"
    compileSdk = 36
    buildToolsVersion = "35.0.0"
    defaultConfig {
        applicationId = "io.github.neultos.wetrip"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.1.2"
    }
    // 테스트 APK는 PC의 기본 디버그 키로 서명. 플레이스토어 출시용 키는 따로 만듦
    buildTypes { getByName("release") { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
