# SPVN CET Portal Mobile

`mobile/native` is the canonical Android/iOS application. It is a native Expo Router app backed by the protected `/api/mobile` routes; it does not redirect to the web portal or embed it in a WebView.

The older Capacitor shell remains in `mobile/android` only for reference. New APK work should happen in `mobile/native`.

## Run in Expo Go

```bash
cd mobile/native
npm install
npm start
```

The default API is `https://spvn.aparaitech.org/api/mobile`. For a local server, create `mobile/native/.env.local`:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.10:5000/api/mobile
```

Use the computer's LAN IP on a physical phone. Android Emulator can use `http://10.0.2.2:5000/api/mobile`.

## Verify

```bash
npm run check
npx expo export --platform android
```

## Build a debug APK

Install Android Studio, Android SDK and JDK 17, then run:

```bash
npm run apk:debug
```

The generated APK is `mobile/native/android/app/build/outputs/apk/debug/app-debug.apk`.
