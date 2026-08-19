# SPVN CET Portal Mobile

This Capacitor project delivers the existing SPVN CET Portal as an Android app. It opens the portal at the top level, so student and administrator functionality stays identical to the tested web backend: authentication, password change, tests, CET section flow, results, documents, notifications, question bank, bulk imports, groups, syllabus, smart scan, test publishing and reports.

## Configure and build

1. Install Node.js, Android Studio, Android SDK Platform Tools, and JDK 17.
2. In this folder run `npm install`.
3. Run `npm run sync` and `npm run assets`.
4. Run `npm run apk:debug`.

The debug APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`. On first launch, enter the publicly reachable portal URL shown by the administrator.

For local Android emulator testing, use `http://10.0.2.2:3000` as `MOBILE_PORTAL_URL`. For a physical phone, use a deployed HTTPS URL or the computer's LAN address with the phone on the same network.
