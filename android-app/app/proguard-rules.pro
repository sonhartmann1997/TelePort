-keepattributes *Annotation*
-keepclassmembers class com.teleport.app.MainActivity$TelePortNativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
