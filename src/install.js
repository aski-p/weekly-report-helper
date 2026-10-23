// 설치 관련 상태: 앱이 뜨자마자 beforeinstallprompt 를 잡아 둔다 (설치 페이지가 나중에 열려도 쓸 수 있게)
let deferred = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit(); });
addEventListener('appinstalled', () => { deferred = null; emit(); });

export const subscribe = (f) => (subs.add(f), () => subs.delete(f));
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return null;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null; emit();
  return outcome;
}

export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return { os: 'ios', safari: !/CriOS|FxiOS|EdgiOS|KAKAOTALK|NAVER|Line/i.test(ua) };
  if (/Android/i.test(ua)) return { os: 'android', inApp: /KAKAOTALK|NAVER|Line|wv\)/i.test(ua) };
  return { os: 'desktop' };
}

// 안드로이드 APK(WebView 래퍼)는 UA 에 WeeklyReportApp 을 붙인다
export const isApkApp = () => /WeeklyReportApp\//.test(navigator.userAgent);

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || isApkApp();
