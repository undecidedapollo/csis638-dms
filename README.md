# CSIS 638 - Data Management System

### Requirements:
- Node.js 20.0 or higher
- Npm
- PostgreSQL to run 

### Setup

```sh
npm install
```

### How to run:

```sh
npm run gen && clear && npm run clean && npm run start src/index2.ts e4.dml 6
```

### How to test output:

Manually run DDL Changes (`out/ddl.sql`) against postgres database.

You can then run some SQL expresions to test the output:
```sql
truncate "BankAccount";
truncate "Transaction";

insert into "BankAccount" ("accountId", "balance") values ('b1', 0);
insert into "BankAccount" ("accountId", "balance") values ('b2', 0);


insert into "Transaction" ("id", "bankAccountId", "amount") values ('t1', 'b1', 1);
insert into "Transaction" ("id", "bankAccountId", "amount") values ('t2', 'b1', 2);
insert into "Transaction" ("id", "bankAccountId", "amount") values ('t3', 'b1', 3);
insert into "Transaction" ("id", "bankAccountId", "amount") values ('t4', 'b2', 7);


select * from "BankAccount";

delete from "Transaction" where "id" = 't2';

select * from "BankAccount";

update "Transaction" set "bankAccountId" = 'b2' where "id" = 't1';

select * from "BankAccount";
```
