import { checkAll } from './checker.js';
const results = await checkAll();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
