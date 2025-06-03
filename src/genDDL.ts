import parser from './bankaccount.cjs';

const inputBefore = `

`;

const inputAfter = `
    BankAccount { 
        accountId: string
    }
`;


const astBefore = inputBefore.trim() !== "" ? parser.parse(inputBefore) : [];

const astAfter = inputAfter.trim() !== "" ? parser.parse(inputAfter) : [];


