import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { PlayerMeta } from './engine/types'

export type Lang = 'ko' | 'en'

/** 봇 표시명/태그라인 (로직 키는 bots.ts, 표시는 언어별) */
const BOT_NAMES: Record<Lang, Record<string, { name: string; tagline: string }>> = {
  ko: {
    hodl: { name: '존버영수', tagline: '사는 건 한 번, 파는 건 없다' },
    momentum: { name: '추세미녀', tagline: '달리는 말에 올라탄다' },
    contrarian: { name: '청개구리', tagline: '남들이 사면 판다' },
    bear: { name: '나스닥곰', tagline: '세상은 결국 무너진다' },
    scalper: { name: '단타치타', tagline: '1틱이라도 먹으면 익절' },
    cautious: { name: '신중부장', tagline: '몰빵은 인생을 망친다' },
    degen: { name: '풀매수광인', tagline: '인생은 한 방' },
  },
  en: {
    hodl: { name: 'HODL Hank', tagline: 'Buys once. Never sells.' },
    momentum: { name: 'Momo Riley', tagline: 'Rides every wave' },
    contrarian: { name: 'Fade Frog', tagline: 'Sells when you buy' },
    bear: { name: 'Nasdaq Bear', tagline: 'It all comes down eventually' },
    scalper: { name: 'Scalp Cheetah', tagline: 'One tick is one meal' },
    cautious: { name: 'Prudent Pete', tagline: 'All-in ruins lives' },
    degen: { name: 'Full-Send Max', tagline: 'YOLO is a strategy' },
  },
}

/** 차트 메타 영어판 (한국어는 charts.json 원본 사용) */
const CHART_EN: Record<string, { name: string; blurb: string }> = {
  msft_2017: {
    name: 'Microsoft',
    blurb: 'The year Azure hit its stride — a quiet, relentless grind upward. Charts like this reward doing nothing.',
  },
  aapl_2019: {
    name: 'Apple',
    blurb: 'Opened with an earnings shock, then marched to new highs all year. Selling the dip here was expensive.',
  },
  nflx_2018: {
    name: 'Netflix',
    blurb: 'Doubled in the first half, nearly halved in the second. The textbook growth-stock rollercoaster.',
  },
  meta_2018: {
    name: 'Meta (Facebook)',
    blurb: 'Privacy scandals, then a single -19% day in July — the largest one-day market-cap wipeout in US history at the time.',
  },
  pypl_2022: {
    name: 'PayPal',
    blurb: 'The rate-hike year. Every bounce that looked like a bottom was just part of the way down.',
  },
  baba_2021: {
    name: 'Alibaba',
    blurb: 'Regulatory risk pressed down all year long. Exhibit A for why averaging down can hurt.',
  },
  gme_2021: {
    name: 'GameStop',
    blurb: 'Retail vs. short-selling hedge funds. January 2021: dozens of times over in weeks — the meme-stock epicenter.',
  },
  amc_2021: {
    name: 'AMC Entertainment',
    blurb: 'A near-bankrupt cinema chain meets the meme army and goes vertical. The only question was when to get off.',
  },
  ko_2015: {
    name: 'Coca-Cola',
    blurb: 'A full year of going nowhere. Trade this busily and you are just donating fees to your broker.',
  },
  t_2015: {
    name: 'AT&T',
    blurb: 'Classic dividend-stock chop. The urge to do something IS the trap in this chart.',
  },
  spy_2020: {
    name: 'S&P 500 (SPY)',
    blurb: 'The March 2020 COVID crash, then the fastest V-recovery in history. Panic sellers and dip buyers parted ways here.',
  },
  tsla_2020: {
    name: 'Tesla',
    blurb: '+700% in a year — but only for those who first survived a 60% drawdown in March.',
  },
}

const THEME_NAMES: Record<Lang, Record<number, string>> = {
  ko: { 1: '워밍업', 2: '변동성 입문', 3: '하락장', 4: '밈 대란', 5: '횡보 지옥', 6: '레전드' },
  en: { 1: 'Warm-up', 2: 'Volatility 101', 3: 'Bear Market', 4: 'Meme Mania', 5: 'Sideways Hell', 6: 'The Legend' },
}

function makeDict(lang: Lang) {
  const ko = lang === 'ko'
  return {
    // ── 로비
    title: ko ? '차트 파티' : 'CHART PARTY',
    kicker: ko ? '8인 동시 대전 · 실제 차트 · 순수 판단력' : '8-PLAYER DUEL · REAL CHARTS · PURE JUDGMENT',
    tag1: ko ? '전원이 똑같은 실제 주식 차트를 받는다.' : 'Everyone gets the exact same real stock chart.',
    tag2: ko ? '1년치가 5분에 재생된다. 판단력만으로 갈린다.' : 'A full year replays in 5 minutes. Only judgment decides.',
    nickname: ko ? '닉네임' : 'CALLSIGN',
    namePlaceholder: ko ? '트레이더명 입력' : 'Enter trader name',
    defaultName: ko ? '나' : 'Me',
    tempo: ko ? '템포' : 'TEMPO',
    speeds: ko
      ? [
          { label: '보통', sub: '15초 · 10초' },
          { label: '빠름', sub: '8초 · 6초' },
          { label: '초스피드', sub: '5초 · 4초' },
        ]
      : [
          { label: 'Normal', sub: '15s · 10s' },
          { label: 'Fast', sub: '8s · 6s' },
          { label: 'Blitz', sub: '5s · 4s' },
        ],
    roster: ko ? '오늘의 상대 — 봇 트레이더 7인' : "TONIGHT'S OPPONENTS — 7 BOT TRADERS",
    start: ko ? '매치 시작' : 'START MATCH',
    startSub: ko ? '6차트 리그전 · 약 30분' : '6-CHART LEAGUE · ~30 MIN',
    rule1: ko
      ? '매 차트 시작 자본 1,000만 · 수익률 순위 포인트 10·7·5·4·3·2·1·0 · 파이널 ×1.5'
      : 'Fresh ₩10M each chart · Rank points 10·7·5·4·3·2·1·0 · Final chart ×1.5',
    rule2: ko
      ? '롱/숏 슬라이더 하나 · 포지션 변경분 수수료 0.5% · 한 틱 -95% 손실 시 강제청산 💥'
      : 'One long/short slider · 0.5% fee on position changes · -95% in one tick = margin call 💥',

    // ── 라운드
    chart: ko ? '차트' : 'CHART',
    decision: ko ? '의사결정' : 'DECISION',
    finalTag: ko ? '파이널 ×1.5' : 'FINAL ×1.5',
    orderPhase: ko ? '주문 접수 중' : 'ORDERS OPEN',
    playPhase: ko ? '차트 재생 중' : 'REPLAYING',
    live: 'LIVE',
    blind1: ko ? '정체불명 종목, 1년치 60틱이 지금부터 재생됩니다' : 'Unknown ticker. One year — 60 ticks — replays from here.',
    blind2: ko ? '첫 창은 깜깜이 배팅 — 감으로 지르세요' : 'First window is a blind bet. Trust your gut.',
    lockBtn: ko ? '락인' : 'LOCK IN',
    lockedBtn: ko ? '락인 완료' : 'LOCKED',
    holding: (pos: string) => (ko ? `포지션 고정 — ${pos} 관전 중` : `Position locked — riding ${pos}`),
    long: ko ? '롱' : 'LONG',
    short: ko ? '숏' : 'SHORT',
    cash: ko ? '현금' : 'CASH',
    cash100: ko ? '현금 100%' : '100% CASH',
    feePreview: (fee: string) => (ko ? `변경 수수료 예상 -${fee}원` : `Est. change fee -₩${fee}`),
    feeNote: ko ? '(변경분의 0.5%)' : '(0.5% of change)',
    quick: ko
      ? ['풀숏', '숏 50', '전량 현금화', '롱 50', '풀매수']
      : ['MAX SHORT', 'SHORT 50', 'ALL CASH', 'LONG 50', 'MAX LONG'],
    ranking: ko ? '실시간 랭킹' : 'LIVE RANKING',
    bank: ko ? '뱅크' : 'BANK',
    liqBanner: (names: string) => (ko ? `강제청산! ${names}` : `MARGIN CALL! ${names}`),
    tickLabel: (t: number) => (ko ? `틱 ${t}/60` : `TICK ${t}/60`),
    vsStart: ko ? '시작가 대비' : 'VS START',
    lastTick: ko ? '직전 틱' : 'LAST TICK',
    tick: ko ? '틱' : 'TICK',
    allLocked: ko ? '전원 체결' : 'ALL LOCKED',

    // ── 정산 쇼
    revealKicker: ko ? '차트 정체 공개' : 'CHART REVEALED',
    benchKicker: ko ? '존버 벤치마크' : 'THE HODL BENCHMARK',
    benchLine1a: ko ? '첫 틱에 풀매수하고 ' : 'Buy tick one, then ',
    benchLine1b: ko ? '가만히만 있었다면' : 'do absolutely nothing',
    benchLine1c: ko ? ' 이만큼이었습니다.' : ' — and this is what you got.',
    benchLine2: ko ? '이론상 완벽한 매매는 ' : 'A theoretically perfect play: ',
    shameLabel: ko ? '📉 존버보다 못 벌었다:' : '📉 Lost to doing nothing:',
    praiseAll: ko ? '🎉 전원이 존버를 이겼다! 이런 판은 흔치 않습니다' : '🎉 Everyone beat the HODL! Rare sight.',
    mySkill: ko ? '내 스킬 점수' : 'MY SKILL SCORE',
    settleKicker: (n: number) => (ko ? `차트 ${n} 정산` : `CHART ${n} SETTLEMENT`),
    settleFinal: ko ? '— 🔥 파이널 ×1.5 적용' : '— 🔥 FINAL ×1.5 APPLIED',
    thTrader: ko ? '트레이더' : 'TRADER',
    thReturn: ko ? '수익률' : 'RETURN',
    thFees: ko ? '수수료' : 'FEES',
    thSkill: ko ? '스킬' : 'SKILL',
    thPts: ko ? '획득 P' : '+PTS',
    thTotal: ko ? '누적 P' : 'TOTAL',
    nextChart: (theme: string) => (ko ? `다음 차트: ${theme}` : `NEXT CHART: ${theme}`),
    toAwards: ko ? '🏆 최종 시상식' : '🏆 FINAL CEREMONY',
    autoNote: (s: number) => (ko ? `${s}초 후 자동 진행` : `Auto-advancing in ${s}s`),

    // ── 최종 시상
    champion: (name: string) => (ko ? `${name} 우승!` : `${name} WINS!`),
    sumPts: ko ? '합계 P' : 'TOTAL',
    copyBtn: ko ? '📋 결과 카드 복사' : '📋 COPY RESULT CARD',
    againBtn: ko ? '한 판 더' : 'RUN IT BACK',
    copied: ko ? '결과가 클립보드에 복사됐습니다 — 붙여넣어 자랑하세요!' : 'Copied to clipboard — go brag!',
    copyFail: ko ? '클립보드 복사 실패 😢' : 'Clipboard copy failed 😢',
    shareTitle: ko ? '📈 차트 파티 — 6차트 리그전 결과' : '📈 CHART PARTY — 6-Chart League Result',
    shareWin: (n: string, p: string) => (ko ? `🏆 우승: ${n} (${p}P)` : `🏆 Winner: ${n} (${p} pts)`),
    shareMe: (rank: number, total: number, p: string) =>
      ko ? `🎖️ 내 순위: ${rank}위 / ${total}명 (${p}P)` : `🎖️ My rank: #${rank} of ${total} (${p} pts)`,
    shareTail: ko ? '같은 차트, 다른 운명. #차트파티' : 'Same chart, different fates. #ChartParty',
    rankSuffix: (r: number) => (ko ? `${r}위` : `#${r}`),

    awards: {
      hodlKing: {
        title: ko ? '존버왕' : 'HODL KING',
        desc: ko ? '거의 움직이지 않고 상위권' : 'Barely moved, still on top',
        detail: (turn: string, ret: string) =>
          ko ? `총 포지션 변경량 ${turn} / 누적 ${ret}` : `Total turnover ${turn} / cumulative ${ret}`,
      },
      scalperGhost: {
        title: ko ? '단타귀신' : 'SCALP GHOST',
        desc: ko ? '가장 부지런히 사고팔았다' : 'Traded like rent was due',
        detail: (turn: string, ret: string) =>
          ko ? `총 포지션 변경량 ${turn} / 누적 ${ret}` : `Total turnover ${turn} / cumulative ${ret}`,
      },
      brokerVip: {
        title: ko ? '증권사 VIP' : 'BROKERAGE VIP',
        desc: ko ? '수수료 최다 납부 — 증권사가 사랑합니다' : 'Top fee payer — your broker loves you',
        detail: (fees: string) => (ko ? `수수료 총 ${fees}원` : `Total fees ₩${fees}`),
      },
      contrarianGenius: {
        title: ko ? '역베천재' : 'CONTRARIAN GENIUS',
        desc: ko ? '남들과 반대로 가서 벌었다' : 'Faded the crowd and got paid',
        detail: (ret: string) => (ko ? `역방향 수익 ${ret}` : `Contrarian profit ${ret}`),
      },
      bottomCatcher: {
        title: ko ? '바닥캐치' : 'BOTTOM CATCHER',
        desc: ko ? '진짜 바닥에서 샀다' : 'Bought the actual bottom',
        detail: (n: number) => (ko ? `바닥 매수 ${n}회 성공` : `${n} bottom ${n === 1 ? 'catch' : 'catches'}`),
      },
    },
  }
}

export type Dict = ReturnType<typeof makeDict>

interface I18n {
  lang: Lang
  setLang: (l: Lang) => void
  t: Dict
  /** 플레이어 표시명 (봇은 언어별) */
  pname: (p: PlayerMeta) => string
  ptagline: (p: PlayerMeta) => string | undefined
  themeName: (theme: number) => string
  chartName: (id: string, koName: string) => string
  chartBlurb: (id: string, koBlurb: string) => string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('cp_lang')
    if (saved === 'ko' || saved === 'en') return saved
    return navigator.language.startsWith('ko') ? 'ko' : 'en'
  })

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('cp_lang', l)
    setLangState(l)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dataset.lang = lang
    document.title = lang === 'ko' ? '차트 파티 — 같은 차트, 다른 운명' : 'Chart Party — Same Chart, Different Fates'
  }, [lang])

  const value = useMemo<I18n>(() => {
    const t = makeDict(lang)
    return {
      lang,
      setLang,
      t,
      pname: (p) => (p.isBot && p.botKey ? BOT_NAMES[lang][p.botKey]?.name ?? p.name : p.name),
      ptagline: (p) => (p.isBot && p.botKey ? BOT_NAMES[lang][p.botKey]?.tagline : undefined),
      themeName: (theme) => THEME_NAMES[lang][theme] ?? '',
      chartName: (id, koName) => (lang === 'ko' ? koName : CHART_EN[id]?.name ?? koName),
      chartBlurb: (id, koBlurb) => (lang === 'ko' ? koBlurb : CHART_EN[id]?.blurb ?? koBlurb),
    }
  }, [lang, setLang])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error('useI18n outside provider')
  return v
}

export { BOT_NAMES }
