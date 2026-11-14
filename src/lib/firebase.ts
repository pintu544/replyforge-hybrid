import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { initializeAppCheck, CustomProvider, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';
import { firebaseConfig, isFirebaseConfigured, appCheckDebugToken, appCheckDebugBuild, recaptchaSiteKey } from './env';

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  ai: AI;
  appCheck: AppCheck | undefined;
}

let cached: FirebaseServices | null | undefined;

/**
 * Initialises Firebase once, or returns null when the web configuration is
 * absent. The app renders an explicit "not configured" state in that case —
 * it never falls back to a guessed project.
 */
export function getFirebaseServices(): FirebaseServices | null {
  if (cached !== undefined) return cached;
  if (!isFirebaseConfigured) {
    cached = null;
    return null;
  }
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // App Check (DESIGN.md). AI Logic enforcement is "Basic – Enforced" in the
  // console. Production builds initialise the registered Fraud Defense
  // (reCAPTCHA Enterprise) provider with the public site key. Local
  // development and the explicitly flagged debug build use the SDK
  // debug-token path instead: setting FIREBASE_APPCHECK_DEBUG_TOKEN before
  // initialise makes the SDK print a debug token to the console and
  // exchange it for a real App Check token; the token must be registered
  // in the console (App Check → Apps → Manage debug tokens) before AI
  // Logic calls succeed.
  let appCheck: AppCheck | undefined;
  if (!import.meta.env.DEV && !appCheckDebugBuild && recaptchaSiteKey) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  if (import.meta.env.DEV || appCheckDebugBuild) {
    const self_ = globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean };
    self_.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheckDebugToken ?? true;
    appCheck = initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: () =>
          Promise.reject(
            new Error('No App Check attestation provider is registered for this build yet.'),
          ),
      }),
      isTokenAutoRefreshEnabled: true,
    });
  }

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  cached = { app, auth, db, ai, appCheck };
  return cached;
}
