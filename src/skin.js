// 스킨(색 컨셉)과 본문 글꼴. 이 기기에 저장하고, 첫 화면을 그리기 전에 적용한다.
import { useCallback, useState, useEffect } from 'react';
import { store } from './api.js';

// 색은 styles.css 의 html[data-skin=…] 에 정의. 여기에는 목록·미리보기용 대표색만.
export const SKINS = [
  { id: 'system', name: '기본', desc: '시스템 밝기 따라감', swatch: ['#f3f5f7', '#ffffff', '#1d2433', '#b5302a'] },
  { id: 'paper', name: '한지', desc: '따뜻한 미색 종이', swatch: ['#f4efe4', '#fffdf7', '#2d2720', '#b23a2e'] },
  { id: 'navy', name: '결재판', desc: '단정한 남색', swatch: ['#eaf0f8', '#ffffff', '#13254a', '#c8102e'] },
  { id: 'forest', name: '숲', desc: '차분한 초록', swatch: ['#ecf2ed', '#fbfdfb', '#1c2e23', '#b4432f'] },
  { id: 'blossom', name: '벚꽃', desc: '연한 분홍', swatch: ['#fbf0f3', '#fffafb', '#3a2330', '#c2185b'] },
  { id: 'sky', name: '하늘', desc: '맑은 파랑', swatch: ['#ebf5fb', '#ffffff', '#0f2c40', '#e0583a'] },
  { id: 'lavender', name: '라벤더', desc: '은은한 보라', swatch: ['#f3f0fa', '#ffffff', '#2e2448', '#7b4bc4'] },
  { id: 'mint', name: '민트', desc: '시원한 청록', swatch: ['#e8f6f2', '#ffffff', '#12362d', '#e0554a'] },
  { id: 'coffee', name: '라떼', desc: '부드러운 갈색', swatch: ['#efe7df', '#fffaf5', '#3b2a20', '#a0522d'] },
  { id: 'peach', name: '복숭아', desc: '포근한 살구', swatch: ['#fff0e8', '#fffaf7', '#4a2a20', '#e8613c'] },
  { id: 'lemon', name: '레몬', desc: '밝은 노랑', swatch: ['#faf6df', '#fffef6', '#3a3415', '#c9302c'] },
  { id: 'ocean', name: '바다', desc: '깊은 청록', swatch: ['#e4f0f4', '#ffffff', '#0b3a4a', '#ff7a45'] },
  { id: 'olive', name: '올리브', desc: '차분한 녹갈색', swatch: ['#eef0e3', '#fbfcf5', '#2f3420', '#b5452f'] },
  { id: 'slate', name: '돌', desc: '회청색 사무실', swatch: ['#eceff2', '#ffffff', '#22303c', '#d14b3a'] },
  { id: 'contrast', name: '고대비', desc: '선명한 흑백', swatch: ['#ffffff', '#ffffff', '#000000', '#c00000'] },
  { id: 'midnight', name: '야간', desc: '푸른 어둠', dark: true, swatch: ['#0f1420', '#171e2e', '#e7ebf3', '#ff6b5e'] },
  { id: 'ink', name: '먹', desc: '무채색 어둠', dark: true, swatch: ['#141414', '#1e1e1e', '#ececec', '#e0533f'] },
  { id: 'amethyst', name: '자수정', desc: '보랏빛 밤', dark: true, swatch: ['#1a1526', '#231d33', '#ece6f7', '#ff79c6'] },
  { id: 'nightforest', name: '밤숲', desc: '어두운 초록', dark: true, swatch: ['#0f1a14', '#16241c', '#e3efe7', '#f0a35b'] },
  { id: 'mocha', name: '모카', desc: '따뜻한 어둠', dark: true, swatch: ['#1c1714', '#271f1b', '#efe6dd', '#e0905a'] },
  { id: 'deepsea', name: '심해', desc: '짙은 남청', dark: true, swatch: ['#06161f', '#0c2230', '#dbeef5', '#ff8a65'] },
];

// css: 구글 폰트 family 파라미터 또는 전체 URL. null 이면 따로 받지 않음. serif: 명조 계열(자간 보정)
export const FONT_KINDS = [['sans', '고딕'], ['serif', '명조'], ['round', '둥근·제목'], ['hand', '손글씨']];
export const FONTS = [
  { id: 'plex', kind: 'sans', name: 'IBM Plex Sans', stack: "'IBM Plex Sans KR'", css: null /* index.html 에서 기본으로 받음 */ },
  { id: 'pretendard', kind: 'sans', name: '프리텐다드', stack: "'Pretendard Variable', Pretendard", css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css' },
  { id: 'suit', kind: 'sans', name: 'SUIT', stack: "'SUIT Variable'", css: 'https://cdn.jsdelivr.net/gh/sunn-us/SUIT@2.0.5/fonts/variable/woff2/SUIT-Variable.css' },
  { id: 'wanted', kind: 'sans', name: '원티드 산스', stack: "'Wanted Sans Variable'", css: 'https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.3/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css' },
  { id: 'spoqa', kind: 'sans', name: '스포카 한 산스', stack: "'Spoqa Han Sans Neo'", css: 'https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@3.3.0/css/SpoqaHanSansNeo.css' },
  { id: 'noto', kind: 'sans', name: '본고딕', stack: "'Noto Sans KR'", css: 'Noto+Sans+KR:wght@400;500;600;700' },
  { id: 'nanum', kind: 'sans', name: '나눔고딕', stack: "'Nanum Gothic'", css: 'Nanum+Gothic:wght@400;700;800' },
  { id: 'gothica1', kind: 'sans', name: '고딕 A1', stack: "'Gothic A1'", css: 'Gothic+A1:wght@400;500;600;700' },
  { id: 'sunflower', kind: 'sans', name: '해바라기', stack: "'Sunflower'", css: 'Sunflower:wght@300;500;700' },
  { id: 'gowun', kind: 'sans', name: '고운돋움', stack: "'Gowun Dodum'", css: 'Gowun+Dodum' },
  { id: 'orbit', kind: 'sans', name: '오르빗', stack: "'Orbit'", css: 'Orbit' },
  { id: 'system', kind: 'sans', name: '기기 기본', stack: 'system-ui', css: null },
  { id: 'myeongjo', kind: 'serif', serif: true, name: '나눔명조', stack: "'Nanum Myeongjo', serif", css: 'Nanum+Myeongjo:wght@400;700;800' },
  { id: 'notoserif', kind: 'serif', serif: true, name: '본명조', stack: "'Noto Serif KR', serif", css: 'Noto+Serif+KR:wght@400;500;600;700' },
  { id: 'hahmlet', kind: 'serif', serif: true, name: '함렛', stack: "'Hahmlet', serif", css: 'Hahmlet:wght@400;500;600;700' },
  { id: 'gowunbatang', kind: 'serif', serif: true, name: '고운바탕', stack: "'Gowun Batang', serif", css: 'Gowun+Batang:wght@400;700' },
  { id: 'songmyung', kind: 'serif', serif: true, name: '송명', stack: "'Song Myung', serif", css: 'Song+Myung' },
  { id: 'jua', kind: 'round', name: '주아', stack: "'Jua'", css: 'Jua' },
  { id: 'dohyeon', kind: 'round', name: '도현', stack: "'Do Hyeon'", css: 'Do+Hyeon' },
  { id: 'gaegu', kind: 'hand', name: '개구', stack: "'Gaegu'", css: 'Gaegu:wght@400;700' },
  { id: 'himelody', kind: 'hand', name: '하이멜로디', stack: "'Hi Melody'", css: 'Hi+Melody' },
  { id: 'poorstory', kind: 'hand', name: '푸어스토리', stack: "'Poor Story'", css: 'Poor+Story' },
  { id: 'gamja', kind: 'hand', name: '감자꽃', stack: "'Gamja Flower'", css: 'Gamja+Flower' },
  { id: 'yeonsung', kind: 'hand', name: '연성', stack: "'Yeon Sung'", css: 'Yeon+Sung' },
];
const FALLBACK = "-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";

const loaded = new Set();
export function loadFont(f) {
  if (!f?.css || loaded.has(f.id)) return;
  loaded.add(f.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = f.css.startsWith('http') ? f.css : `https://fonts.googleapis.com/css2?family=${f.css}&display=swap`;
  document.head.appendChild(link);
}

const read = () => ({ skin: store.get('wr.skin') || 'system', font: store.get('wr.font') || 'plex' });

export function applySkin({ skin, font } = read()) {
  const root = document.documentElement;
  const s = SKINS.find((x) => x.id === skin) || SKINS[0];
  const f = FONTS.find((x) => x.id === font) || FONTS[0];
  if (s.id === 'system') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', s.id);
  root.toggleAttribute('data-dark', !!s.dark);
  root.style.setProperty('--sans', `${f.stack}, ${FALLBACK}`);
  root.toggleAttribute('data-serif', !!f.serif);
  loadFont(f);
  // 주소창·상태바 색도 맞춘다 (기본은 원래 값)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = s.id === 'system' ? '#1d2433' : s.swatch[0];
}

export function useSkin() {
  const [state, setState] = useState(read);
  useEffect(()=>{const sync=()=>{const next=read();setState(next);applySkin(next);};addEventListener('wr:account-sync',sync);return()=>removeEventListener('wr:account-sync',sync);},[]);
  const set = useCallback((patch) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      store.set('wr.skin', next.skin === 'system' ? null : next.skin);
      store.set('wr.font', next.font === 'plex' ? null : next.font);
      applySkin(next);
      return next;
    });
  }, []);
  return [state, set];
}
