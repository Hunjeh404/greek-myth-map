# 그리스 신화 관계도

그리스 신화의 신·영웅·괴물을 검색하고 관계도로 살펴보는 정적 웹 앱입니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `index.html` | 앱 (검색, 관계도, 인물 카드) |
| `data.js` | 인물 392명, 관계 939개, 에피소드 데이터 |
| `images/` | 일러스트 폴더 (`images/README.txt` 참고) |
| `.nojekyll` | GitHub Pages에서 Jekyll 처리를 건너뛰게 하는 빈 파일 |

주소 뒤에 `#zeus`처럼 인물 id를 붙이면 그 인물의 관계도가 바로 열립니다.

## GitHub Pages 배포

1. 저장소 **Settings → Pages**로 이동합니다.
2. **Build and deployment → Source**에서 **Deploy from a branch**를 고릅니다.
3. **Branch**는 `main`, 폴더는 `/ (root)`로 정하고 저장합니다.
4. 1~2분 뒤 `https://<사용자명>.github.io/greek-myth-map/`에서 열립니다.

모든 경로가 상대 경로라서 `/greek-myth-map/` 같은 하위 경로에서도 그대로 동작합니다.

## 그림 추가·교체

`images/ui/`, `images/icons/`, `images/portraits/`에 `.png` 파일을 넣고 커밋·푸시하면
Pages가 다시 배포되면서 앱이 자동으로 불러옵니다. 그림이 없는 항목은 기본 표시(이름 첫 글자 배지 등)로 대신합니다.
