import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthOptional } from './AuthContext';
import { AppFeatureId, FEATURE_CATALOG_MAP } from '../lib/featureCatalog';

export interface AppBrandingConfig {
  appName: string;              // e.g. "SPI SMART"
  appTagline: string;           // e.g. "RBIA"
  appFullName: string;          // e.g. "Sistem Informasi Pengawasan Intern Berbasis Risiko"
  institutionName: string;      // e.g. "Perumda Air Minum Tirta Saiyo Kabupaten Pasaman"
  shortInstitutionName: string; // e.g. "Perumda Tirta Saiyo Pasaman"
  address: string;              // e.g. "Jl. Jenderal Sudirman No. 12, Lubuk Sikaping, Kab. Pasaman, Sumatera Barat"
  phone: string;                // e.g. "(0753) 20123"
  email: string;                // e.g. "spi@tirtasaiyo.co.id"
  website: string;              // e.g. "www.tirtasaiyo.co.id"
  logoType: 'default' | 'image';
  logoUrl: string;              // Data URL (base64) or direct image URL
  logoThemeColor?: string;      // Accent ring/color
  accentColor?: string;         // Alias for logoThemeColor
  officeAddress?: string;       // Alias for address
  officePhone?: string;         // Alias for phone
  officeEmail?: string;         // Alias for email
  featureNames?: Record<string, string>;
  featureTitles?: Record<string, string>;
  sectionNames?: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_BRANDING: AppBrandingConfig = {
  appName: 'SPI SMART',
  appTagline: 'RBIA',
  appFullName: 'Sistem Informasi Pengawasan Intern Berbasis Risiko (RBIA)',
  institutionName: 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman',
  shortInstitutionName: 'Perumda Tirta Saiyo Pasaman',
  address: 'Lubuk Sikaping, Kabupaten Pasaman, Sumatera Barat',
  phone: '(0753) 20123',
  email: 'spi@tirtasaiyo.co.id',
  website: 'www.tirtasaiyo.co.id',
  logoType: 'default',
  logoUrl: '',
  logoThemeColor: '#10b981',
  featureNames: {},
  featureTitles: {},
  sectionNames: {},
};

interface AppBrandingContextType {
  branding: AppBrandingConfig;
  loading: boolean;
  updateBranding: (newConfig: Partial<AppBrandingConfig>) => Promise<void>;
  resetBranding: () => Promise<void>;
  getFeatureLabel: (featureId: AppFeatureId, fallback?: string) => string;
  getFeatureTitle: (featureId: AppFeatureId, fallback?: string) => string;
  getSectionTitle: (sectionKey: string, fallback: string) => string;
  canEditBranding: boolean;
}

const AppBrandingContext = createContext<AppBrandingContextType | undefined>(undefined);

export const AppBrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuthOptional();
  const userProfile = auth?.userProfile;
  const [branding, setBranding] = useState<AppBrandingConfig>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);

  // Kepala SPI and Admin Sistem are authorized to change branding & feature names
  const canEditBranding = userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM';

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'app_settings', 'branding'),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Partial<AppBrandingConfig>;
          const merged: AppBrandingConfig = {
            ...DEFAULT_BRANDING,
            ...data,
            featureNames: data.featureNames || {},
            featureTitles: data.featureTitles || {},
            sectionNames: data.sectionNames || {},
          };
          setBranding(merged);

          // Dynamically update document title
          if (merged.appName && merged.shortInstitutionName) {
            document.title = `${merged.appName} - ${merged.shortInstitutionName}`;
          }
        } else {
          setBranding(DEFAULT_BRANDING);
          document.title = `${DEFAULT_BRANDING.appName} - ${DEFAULT_BRANDING.shortInstitutionName}`;
        }
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching branding settings:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const updateBranding = async (newConfig: Partial<AppBrandingConfig>) => {
    try {
      const payload: AppBrandingConfig = {
        ...branding,
        ...newConfig,
        featureNames: newConfig.featureNames !== undefined ? newConfig.featureNames : (branding.featureNames || {}),
        featureTitles: newConfig.featureTitles !== undefined ? newConfig.featureTitles : (branding.featureTitles || {}),
        sectionNames: newConfig.sectionNames !== undefined ? newConfig.sectionNames : (branding.sectionNames || {}),
        updatedAt: new Date().toISOString(),
        updatedBy: userProfile?.displayName || userProfile?.email || 'Kepala SPI',
      };

      await setDoc(doc(db, 'app_settings', 'branding'), payload, { merge: true });
      setBranding(payload);
    } catch (err) {
      console.error('Failed to update branding settings:', err);
      throw err;
    }
  };

  const resetBranding = async () => {
    try {
      const payload: AppBrandingConfig = {
        ...DEFAULT_BRANDING,
        updatedAt: new Date().toISOString(),
        updatedBy: userProfile?.displayName || userProfile?.email || 'Kepala SPI (Reset)',
      };

      await setDoc(doc(db, 'app_settings', 'branding'), payload);
      setBranding(payload);
    } catch (err) {
      console.error('Failed to reset branding settings:', err);
      throw err;
    }
  };

  const getFeatureLabel = useCallback(
    (featureId: AppFeatureId, fallback?: string) => {
      const custom = branding.featureNames?.[featureId]?.trim();
      if (custom) return custom;
      if (fallback) return fallback;
      return FEATURE_CATALOG_MAP[featureId]?.defaultLabel || featureId;
    },
    [branding.featureNames]
  );

  const getFeatureTitle = useCallback(
    (featureId: AppFeatureId, fallback?: string) => {
      const customTitle = branding.featureTitles?.[featureId]?.trim();
      if (customTitle) return customTitle;
      const customName = branding.featureNames?.[featureId]?.trim();
      if (customName) return customName;
      if (fallback) return fallback;
      return FEATURE_CATALOG_MAP[featureId]?.defaultNavbarTitle || featureId;
    },
    [branding.featureTitles, branding.featureNames]
  );

  const getSectionTitle = useCallback(
    (sectionKey: string, fallback: string) => {
      const custom = branding.sectionNames?.[sectionKey]?.trim();
      return custom || fallback;
    },
    [branding.sectionNames]
  );

  return (
    <AppBrandingContext.Provider
      value={{
        branding,
        loading,
        updateBranding,
        resetBranding,
        getFeatureLabel,
        getFeatureTitle,
        getSectionTitle,
        canEditBranding,
      }}
    >
      {children}
    </AppBrandingContext.Provider>
  );
};

export const useAppBranding = () => {
  const context = useContext(AppBrandingContext);
  if (!context) {
    throw new Error('useAppBranding must be used within an AppBrandingProvider');
  }
  return context;
};
