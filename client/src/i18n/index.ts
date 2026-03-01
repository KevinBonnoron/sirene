import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: navigator.language.startsWith('fr') ? 'fr' : 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});
