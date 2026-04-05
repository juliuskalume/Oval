# Oval Android Wrapper

Native Android shell for the hosted Oval client at `https://oval-nine.vercel.app/`.

## App Settings

- App name: `Oval`
- Package name: `com.sentirax.oval`
- Hosted entry URL: `https://oval-nine.vercel.app/`

## Build

From the `android/` directory:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot'
$env:ANDROID_HOME='C:\Users\Lenovo\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\gradlew.bat assembleDebug
```

## Output

Debug APK:

`app/build/outputs/apk/debug/app-debug.apk`

## Notes

- Internal Oval links stay inside the app.
- External links open in a browser custom tab.
- Back press closes popups first, then navigates WebView history, then backgrounds the app.
- File pickers from the hosted site are supported.
