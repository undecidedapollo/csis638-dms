# CSIS 638 - Data Management System

How to run:

```sh
npm run gen && clear && npm run start src/index.ts
```

How to test output:

Manually run DDL Changes (`a.sql`) against postgres / cockroach database

Then to test the generated SDK work:

```sh
npm run start atest.ts
```
