import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

function getFirebaseAuth() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export interface GooglePopupResult {
  idToken: string;
  accessToken?: string;
  email: string;
  displayName: string;
  photoURL: string;
}

export async function signInWithGooglePopup(): Promise<GooglePopupResult> {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/userinfo.email');
  provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const idToken = await result.user.getIdToken(true);

    return {
      idToken,
      accessToken: credential?.accessToken || undefined,
      email: result.user.email || '',
      displayName: result.user.displayName || '',
      photoURL: result.user.photoURL || '',
    };
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    const host = typeof window !== 'undefined' ? window.location.hostname : '';

    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Jendela login Google ditutup sebelum selesai. Silakan coba lagi.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Popup login Google diblokir oleh browser Anda. Izinkan popup untuk situs ini lalu ulangi.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        `Domain "${host}" belum terdaftar pada Authorized Domains Google/Firebase Auth (${firebaseConfig.projectId}). Tambahkan domain ini di Firebase Console -> Authentication -> Settings -> Authorized domains.`
      );
    }
    if (code === 'auth/operation-not-allowed') {
      throw new Error(
        'Penyedia Google Sign-In belum diaktifkan di proyek Firebase Auth ini.'
      );
    }
    if (code === 'auth/network-request-failed') {
      throw new Error('Koneksi ke server Google OAuth gagal. Periksa internet Anda dan coba lagi.');
    }

    throw new Error(
      (err as Error).message || 'Autentikasi Google OAuth gagal. Silakan coba kembali.'
    );
  }
}

export async function signOutFromFirebase(): Promise<void> {
  try {
    const auth = getFirebaseAuth();
    await signOut(auth);
  } catch {
    // Ignore client Firebase sign-out failures
  }
}
