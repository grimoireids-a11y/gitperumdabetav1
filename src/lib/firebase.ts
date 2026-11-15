import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  getDocsFromServer,
  collection,
  limit,
  query,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const envProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
const envApiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
const envAuthDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
const envAppId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
const envStorageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
const envMessagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
const envDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID?.trim();

const useEnvOverride = Boolean(envProjectId && envApiKey && envAppId);

const resolvedFirebaseConfig = useEnvOverride
  ? {
      projectId: envProjectId!,
      apiKey: envApiKey!,
      authDomain: envAuthDomain || `${envProjectId}.firebaseapp.com`,
      appId: envAppId!,
      storageBucket: envStorageBucket || `${envProjectId}.firebasestorage.app`,
      messagingSenderId: envMessagingSenderId || '',
    }
  : firebaseAppletConfig;

const appletDbId = (firebaseAppletConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
const customDbId = useEnvOverride
  ? envDatabaseId && envDatabaseId !== '(default)'
    ? envDatabaseId
    : undefined
  : typeof appletDbId === 'string' && appletDbId.length > 0 && appletDbId !== '(default)'
  ? appletDbId
  : undefined;

const app = initializeApp(resolvedFirebaseConfig);
export const db = customDbId ? getFirestore(app, customDbId) : getFirestore(app);
export const auth = getAuth(app);

export const activeFirebaseInfo = {
  projectId: resolvedFirebaseConfig.projectId,
  databaseId: customDbId || '(default)',
  authDomain: resolvedFirebaseConfig.authDomain,
  source: useEnvOverride ? 'vercel-env' : 'firebase-applet-config',
} as const;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface FirestoreConnectionCheckResult {
  connected: boolean;
  projectId: string;
  databaseId: string;
  latencyMs: number;
  error?: string;
}

export async function verifyFirestoreConnection(): Promise<FirestoreConnectionCheckResult> {
  const started = performance.now();
  try {
    await getDocsFromServer(query(collection(db, 'users'), limit(1)));
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    return {
      connected: true,
      projectId: activeFirebaseInfo.projectId,
      databaseId: activeFirebaseInfo.databaseId,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Math.round(performance.now() - started));
    return {
      connected: false,
      projectId: activeFirebaseInfo.projectId,
      databaseId: activeFirebaseInfo.databaseId,
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Test initial connection on app startup
export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'app_settings', 'branding'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase Firestore client appears offline or connecting...');
    }
  }
}
