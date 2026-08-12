const readline = require('readline');

function askYesNo(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

function askChoice(choices, promptMessage) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    choices.forEach((c, i) => {
      const rankStr = c.rankLabel ? ` (${c.rankLabel})` : '';
      console.log(`  ${i + 1}. ${c.label}${rankStr} — ${c.description || 'no description'}`);
    });
    console.log('');
    rl.question(`  ${promptMessage} [1]: `, answer => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num >= 1 && num <= choices.length) {
        resolve(num - 1);
      } else {
        resolve(0);
      }
    });
  });
}

module.exports = { askYesNo, askChoice };
