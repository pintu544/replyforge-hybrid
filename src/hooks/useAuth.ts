import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { getFirebaseServices } from '../lib/firebase';

export interface AuthState {
  configured: boolean;
  loading: boolean;
  user: User | null;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  registerEmail: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

export function useAuth(): AuthState {
  const services = getFirebaseServices();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(services !== null);

  useEffect(() => {
    if (!services) return;
    const unsub = onAuthStateChanged(services.auth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return unsub;
  }, [services]);

  return {
    configured: services !== null,
    loading,
    user,
    signInGoogle: async () => {
      if (!services) throw new Error('Firebase is not configured.');
      await signInWithPopup(services.auth, new GoogleAuthProvider());
    },
    signInEmail: async (email, password) => {
      if (!services) throw new Error('Firebase is not configured.');
      await signInWithEmailAndPassword(services.auth, email, password);
    },
    registerEmail: async (email, password) => {
      if (!services) throw new Error('Firebase is not configured.');
      await createUserWithEmailAndPassword(services.auth, email, password);
    },
    signOutUser: async () => {
      if (!services) return;
      await signOut(services.auth);
    },
  };
}
