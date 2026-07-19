// 차트 파티 데이터 파이프라인
// data-raw/*.json (Yahoo Finance v8 chart API 응답) → src/data/charts.json
// - 일봉 ~250개를 60틱 OHLC로 리샘플
// - 첫 틱 시가를 100으로 정규화
// - 종목/기간/해설 메타데이터 부착 (정산 쇼에서 공개)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TICKS = 60

// theme: §2.2 차트 라인업 슬롯 (1~6)
const MANIFEST = [
  {
    file: 'msft_2017.json', theme: 1, symbol: 'MSFT', name: '마이크로소프트',
    period: '2016.11 – 2017.12',
    blurb: '클라우드(Azure) 전환이 본궤도에 오르며 조용히, 그러나 꾸준히 우상향한 해. 이런 차트는 존버가 답이다.',
  },
  {
    file: 'aapl_2019.json', theme: 1, symbol: 'AAPL', name: '애플',
    period: '2019.01 – 2019.12',
    blurb: '1월 실적 쇼크로 출발했지만, 이후 1년 내내 신고가 행진. 흔들림에 팔았다면 배가 아팠을 차트.',
  },
  {
    file: 'nflx_2018.json', theme: 2, symbol: 'NFLX', name: '넷플릭스',
    period: '2018.01 – 2018.12',
    blurb: '상반기에 두 배로 치솟고 하반기에 거의 반토막. 실적 시즌마다 널뛰던 성장주 롤러코스터의 교과서.',
  },
  {
    file: 'meta_2018.json', theme: 2, symbol: 'META', name: '메타(페이스북)',
    period: '2018.01 – 2018.12',
    blurb: '개인정보 스캔들과 7월의 하루 -19% 폭락. 미국 증시 역사상 최대 규모의 하루 시가총액 증발이 이 안에 있다.',
  },
  {
    file: 'pypl_2022.json', theme: 3, symbol: 'PYPL', name: '페이팔',
    period: '2022.01 – 2022.12',
    blurb: '금리 인상의 해, 팬데믹 수혜주의 긴 겨울. 반등처럼 보인 모든 구간이 하락의 일부였다.',
  },
  {
    file: 'baba_2021.json', theme: 3, symbol: 'BABA', name: '알리바바',
    period: '2021.01 – 2021.12',
    blurb: '규제 리스크가 1년 내내 짓누른 차트. 물타기가 왜 위험한지 보여주는 표본.',
  },
  {
    file: 'gme_2021.json', theme: 4, symbol: 'GME', name: '게임스탑',
    period: '2020.07 – 2021.06',
    blurb: '개미 대 공매도 헤지펀드. 2021년 1월, 몇 주 만에 수십 배가 된 밈 주식 대란의 진앙지.',
  },
  {
    file: 'amc_2021.json', theme: 4, symbol: 'AMC', name: 'AMC 엔터테인먼트',
    period: '2021.01 – 2021.12',
    blurb: '파산 직전의 영화관 체인이 밈 군단을 만나 수직 상승. 문제는 언제 내리느냐였다.',
  },
  {
    file: 'ko_2015.json', theme: 5, symbol: 'KO', name: '코카콜라',
    period: '2015.01 – 2015.12',
    blurb: '1년 내내 제자리걸음. 이런 차트에서 부지런히 사고팔면 수수료만 증권사에 헌납하게 된다.',
  },
  {
    file: 't_2015.json', theme: 5, symbol: 'T', name: 'AT&T',
    period: '2015.01 – 2015.12',
    blurb: '전형적인 배당주 횡보. 뭔가 해보고 싶은 충동 자체가 이 차트의 함정이다.',
  },
  {
    file: 'spy_2020.json', theme: 6, symbol: 'SPY', name: 'S&P 500 (SPY)',
    period: '2019.09 – 2020.08',
    blurb: '2020년 3월 코로나 대폭락, 그리고 역사상 가장 빠른 V자 회복. 공포에 판 사람과 산 사람의 운명이 갈렸다.',
  },
  {
    file: 'tsla_2020.json', theme: 6, symbol: 'TSLA', name: '테슬라',
    period: '2020.01 – 2020.12',
    blurb: '1년에 +700%. 3월 폭락으로 반토막을 먼저 견딘 사람만이 그 수익을 가져갔다.',
  },
]

const THEME_NAMES = {
  1: '워밍업',
  2: '변동성 입문',
  3: '하락장',
  4: '밈 대란',
  5: '횡보 지옥',
  6: '레전드',
}

function parseYahoo(file) {
  const raw = JSON.parse(readFileSync(join(root, 'data-raw', file), 'utf8'))
  const r = raw.chart.result[0]
  const q = r.indicators.quote[0]
  const rows = []
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i]
    if (o == null || h == null || l == null || c == null) continue
    rows.push({ o, h, l, c })
  }
  return rows
}

function resample(rows, ticks) {
  const out = []
  for (let i = 0; i < ticks; i++) {
    const from = Math.floor((i * rows.length) / ticks)
    const to = Math.floor(((i + 1) * rows.length) / ticks)
    const bucket = rows.slice(from, Math.max(to, from + 1))
    out.push({
      o: bucket[0].o,
      h: Math.max(...bucket.map((b) => b.h)),
      l: Math.min(...bucket.map((b) => b.l)),
      c: bucket[bucket.length - 1].c,
    })
  }
  return out
}

function normalize(candles) {
  const base = candles[0].o
  const r4 = (x) => Math.round((x / base) * 100 * 10000) / 10000
  return candles.map((k) => ({ o: r4(k.o), h: r4(k.h), l: r4(k.l), c: r4(k.c) }))
}

/**
 * 종가 체인 연결: 캔들 i의 시가를 캔들 i-1의 종가로 강제.
 * 이유 — 게임 손익은 종가→종가 수익률로 계산되므로(갭 포함), 시가-종가 몸통을
 * 그대로 그리면 주말/이벤트 갭 구간에서 화면과 손익이 어긋난다 (예: META 2018.2월
 * -5% 갭다운, 2018.7월 -19% 실적 갭). 몸통이 곧 그 틱의 실제 수익률이 되도록
 * 연결하고, 고가/저가는 갭 범위를 포함해 확장한다. 종가는 건드리지 않으므로
 * 시뮬레이션 수치는 완전히 동일하다.
 */
function chainOpens(candles) {
  const out = [candles[0]]
  for (let i = 1; i < candles.length; i++) {
    const k = candles[i]
    const o = out[i - 1].c
    out.push({ o, h: Math.max(k.h, o), l: Math.min(k.l, o), c: k.c })
  }
  return out
}

const charts = MANIFEST.map((m, idx) => {
  const daily = parseYahoo(m.file)
  if (daily.length < 100) throw new Error(`${m.file}: only ${daily.length} rows`)
  const candles = chainOpens(normalize(resample(daily, TICKS)))
  const buyHoldPct = (candles[TICKS - 1].c / candles[0].o - 1) * 100
  return {
    id: m.file.replace('.json', ''),
    theme: m.theme,
    themeName: THEME_NAMES[m.theme],
    symbol: m.symbol,
    name: m.name,
    period: m.period,
    blurb: m.blurb,
    days: daily.length,
    candles,
  }
})

// 검증 리포트
for (const c of charts) {
  const closes = c.candles.map((k) => k.c)
  const min = Math.min(...c.candles.map((k) => k.l))
  const max = Math.max(...c.candles.map((k) => k.h))
  const bh = (closes[TICKS - 1] / c.candles[0].o - 1) * 100
  console.log(
    `[테마${c.theme} ${c.themeName}] ${c.symbol} ${c.period} — ${c.days}일 → 60틱 | ` +
    `존버 ${bh >= 0 ? '+' : ''}${bh.toFixed(1)}% | 저점 ${min.toFixed(1)} 고점 ${max.toFixed(1)}`
  )
}

mkdirSync(join(root, 'src', 'data'), { recursive: true })
writeFileSync(join(root, 'src', 'data', 'charts.json'), JSON.stringify(charts))
console.log(`\nsrc/data/charts.json 생성 완료 (${charts.length}개 차트)`)
