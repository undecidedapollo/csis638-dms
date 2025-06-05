# CSIS 638 - Data Management System

### Requirements:
- Node.js 20.0 or higher
- Npm
- PostgreSQL or CockroachDB to run 

### Setup

```sh
npm install
```

### How to run:

```sh
npm run gen && clear && npm run start src/index.ts
```

### How to test output:

Manually run DDL Changes (`gen.sql`) against postgres / cockroach database, ensuring they are ran in the database `dbapp`. Create this if it does not exist

Then to test the generated SDK work:

```sh
npm run start atest.ts
```
