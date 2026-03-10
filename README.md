# 🇦🇪 UAE 뉴스 브리핑

두바이·아부다비·UAE 한국어 뉴스를 그룹핑·필터링하여 보여주는 개인 대시보드.

---

## 📁 파일 구조

```
uae-briefing/
├── api/
│   └── news.js          ← Vercel 서버리스 함수 (네이버 API + OG 이미지)
├── public/
│   └── index.html       ← 프론트엔드
├── vercel.json          ← 라우팅 설정
└── README.md
```

---

## 🚀 배포 방법 (Vercel)

### 1단계: 네이버 API 키 발급
1. https://developers.naver.com 접속 → 로그인
2. Application → 애플리케이션 등록
3. 이름: `UAE뉴스브리핑`, 사용 API: **검색** 선택
4. 환경: Web → URL: `https://your-project.vercel.app`
5. Client ID / Client Secret 복사

### 2단계: GitHub에 올리기
```bash
cd uae-briefing
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_ID/uae-briefing.git
git push -u origin main
```

### 3단계: Vercel 연결
1. https://vercel.com → New Project → GitHub repo 선택
2. **Environment Variables** 추가:
   - `NAVER_CLIENT_ID` = 복사한 Client ID
   - `NAVER_CLIENT_SECRET` = 복사한 Client Secret
3. Deploy 클릭

배포 완료! `https://uae-briefing.vercel.app` 같은 URL로 접속 가능.

---

## 🔧 로컬 테스트

```bash
npm i -g vercel
vercel dev
```
`.env.local` 파일 생성:
```
NAVER_CLIENT_ID=여기에_입력
NAVER_CLIENT_SECRET=여기에_입력
```

---

## ✨ 주요 기능

| 기능 | 설명 |
|------|------|
| **OG 썸네일** | 기사 URL에서 og:image 자동 추출 |
| **중복 묶기** | 제목 유사도로 같은 사건 기사를 그룹핑 |
| **대표기사 선정** | [단독] > 주요 언론사 > 최신 순 |
| **독창성 배지** | 단독/심층/보도자료성 자동 분류 |
| **키워드 필터** | 원하는 주제만, 싫은 주제는 제외 |
| **숨기기** | 읽은 기사 개별 숨김 |

---

## 📌 참고

- 네이버 검색 API: 하루 25,000회 무료
- OG 이미지 fetch: 기사당 1회 (그룹 대표 기사만)
- Vercel 무료 플랜으로 충분히 운영 가능
