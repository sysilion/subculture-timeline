# 서브컬쳐 게임 타임라인

여러 서브컬쳐 가챠 게임의 배너·이벤트·버전 일정을 한 화면에서 비교하는 정적 타임라인 사이트.

## 실행 방법

```bash
# Python 3
python3 -m http.server 8765

# Node.js
npx serve .
```

브라우저에서 `http://localhost:8765` 접속.

## 파일 구조

```
.
├── index.html          # 메인 페이지
├── css/style.css       # 다크 테마 + 간트 레이아웃
├── js/timeline.js      # 타임라인 렌더링 엔진
├── data/games.json     # 📝 게임·배너 일정 데이터 (여기만 편집)
└── README.md
```

## 게임 일정 추가/수정

`data/games.json`의 해당 게임 `entries` 배열에 항목 추가:

```jsonc
{
  "type": "banner",          // banner | version
  "title": "캐릭터명 (Debut)",
  "subtitle": "Phase 1",     // 선택
  "rarity": 5,               // 선택
  "start": "2026-06-01",     // YYYY-MM-DD
  "end": "2026-06-24",
  "version": "4.3",
  "tentative": true,         // 미확정이면 true
  "source": "game8.co"       // 출처 (선택)
}
```

## 수록 게임 (2026-06-02 기준)

| 게임 | 버전 | 데이터 출처 |
|------|------|------------|
| 원신 임팩트 | 6.6 ~ 6.7 | earlygg.com |
| 붕괴: 스타레일 | 4.3 ~ 4.4 | game8.co / lootbar.com |
| 명조: 워더링 웨이브 | 3.3 ~ 3.4 | pcgamesn.com |
| 젠레스 존 제로 | 2.8 ~ 3.0 | game8.co / icy-veins.com |
| 명일방주: 엔드필드 | 1.2 ~ 1.3 | game8.co / buffhub.com |
| 이환 (NTE) | 1.0 ~ 1.2 | buffhub.com / neverness.gg |
| 몬길: STAR DIVE | 1.0 ~ 1.2 | mongilstardive.wiki |

> ⚠ 미확정(tentative) 일정은 커뮤니티 추적/리크 기반이며 변동될 수 있습니다.

## 추가 후보 게임

아래 게임은 `games.json`의 `candidates` 배열에 메타만 있습니다.
데이터 추가 시 `games` 배열로 이동하세요.

- 블루 아카이브 (Nexon / Yostar)
- 승리의 여신: 니케 (Shift Up)
- 소녀전선 2: 망명 (Sunborn)
- 리버스: 1999 (Bluepoch)
- 림버스 컴퍼니 (Project Moon)
- 트릭컬 RE:VIVE (Dexter Studio)
- 스텔라 소라 (Papaya Studio)
- 러브 앤 딥스페이스 (Infold Games)

## 참고 사이트

- [paimon.moe/timeline](https://paimon.moe/timeline) — 원신
- [wuwatracker.com/ko/timeline](https://wuwatracker.com/ko/timeline) — 명조
- [zzz.rng.moe/en/timeline](https://zzz.rng.moe/en/timeline) — 젠레스
- [subgamecals.com](https://www.subgamecals.com/) — 국내 통합 서브컬쳐 일정
