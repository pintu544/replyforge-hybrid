/**
 * Environment configuration. The app must boot and explain itself when the
 * Firebase web configuration is absent (placeholders), so nothing here throws.
 */
export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const env = import.meta.env;

export const firebaseConfig: FirebaseEnvConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
};

/** True only when every value needed to initialise Firebase is present. */
export const isFirebaseConfigured: boolean =
  firebaseConfig.apiKey.length > 0 &&
  firebaseConfig.authDomain.length > 0 &&
  firebaseConfig.projectId.length > 0 &&
  firebaseConfig.appId.length > 0;

export const appCheckDebugToken: string | undefined =
  env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || undefined;

/**
 * True only for the explicitly flagged hosted-demo build
 * (VITE_APPCHECK_DEBUG_BUILD=true at build time). That build initialises
 * App Check through the registered debug token — the path the hackathon
 * rules accept — until the production reCAPTCHA v3 registration replaces
 * it. Ordinary production builds leave this off.
 */
export const appCheckDebugBuild: boolean = env.VITE_APPCHECK_DEBUG_BUILD === 'true';

export const cloudModelName: string = env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';
