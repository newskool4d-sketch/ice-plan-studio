# v0.1 fixture의 v0.2 재생성본

`test-data/*.model.json`의 기존 v0.1 fixture는 삭제하거나 덮어쓰지 않는다. 아래 명령은
각 모델을 Plan IR v0.2로 승격하고 `boncheong` 신규 템플릿 HWPX를 이 폴더에 나란히
생성한다.

```powershell
npm run regenerate:migrated-fixtures
```

구조 검증 결과와 모델·HWPX SHA-256은 `verification-log.json`에 기록한다.
