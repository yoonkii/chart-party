import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// 주의: 게임 루프가 명령형 타이머/rAF 기반이라 StrictMode(이펙트 2회 실행)는 쓰지 않는다.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
